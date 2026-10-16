const express = require('express');
const twilio = require('twilio');
const db = require('../db');
const config = require('../config');
const { montarMensagem } = require('../services/mensagem');
const { enviarAlerta } = require('../services/alerta');

const router = express.Router();
const VOZ = { voice: 'Polly.Vitoria', language: 'pt-BR' };

let client;
function getClient() {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

// Guarda por 2 minutos as chamadas já confirmadas na API, para não consultar a cada webhook.
const verificadas = new Map();

// Usado quando o pedido chega sem X-Twilio-Signature (observado na conta trial):
// confirma na API da Twilio que a ligação é nossa e está em andamento.
async function chamadaLegitima(req) {
  const body = req.body || {};
  const sid = body.CallSid;
  if (!/^CA[0-9a-f]{32}$/.test(sid || '')) return false;

  const visto = verificadas.get(sid);
  if (visto && Date.now() - visto < 120000) return true;

  const call = await getClient().calls(sid).fetch();
  const ok =
    ['ringing', 'in-progress'].includes(call.status) &&
    call.direction === 'outbound-api' &&
    call.from === config.twilio.phoneNumber &&
    call.from === body.From &&
    call.to === body.To;

  if (ok) verificadas.set(sid, Date.now());
  return ok;
}

router.use(async (req, res, next) => {
  const assinatura = req.get('X-Twilio-Signature');
  const url = config.baseUrl + req.originalUrl;
  try {
    if (assinatura) {
      if (twilio.validateRequest(config.twilio.authToken, assinatura, url, req.body || {})) {
        return next();
      }
      console.log(`[twilio] 403 em ${req.originalUrl}: assinatura presente mas inválida`);
      return res.status(403).send('Assinatura inválida.');
    }
    if (await chamadaLegitima(req)) return next();
    if (config.dryRun && (!req.body || !req.body.CallSid)) return next();
    console.log(`[twilio] 403 em ${req.originalUrl}: sem assinatura e chamada não confirmada na API`);
    return res.status(403).send('Não autorizado.');
  } catch (e) {
    console.error(`[twilio] erro ao verificar a chamada em ${req.originalUrl}:`, e.message);
    return res.status(403).send('Não autorizado.');
  }
});

function lerIds(req) {
  return String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

// Só muda chamadas que ainda estão "discando", para não sobrescrever um resultado já definido.
function atualizar(ids, status) {
  if (!ids.length) return 0;
  const marcadores = ids.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE chamadas SET status = ?, atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores}) AND status = 'discando'`
    )
    .run(status, ...ids).changes;
}

const consultarPorCallSid = db.prepare(`
  SELECT c.id, c.horario_id, c.data, c.tentativa, h.hora,
         m.nome AS medicamento, m.descricao,
         p.id AS paciente_id, p.nome AS paciente, p.telefone,
         p.cuidador_nome, p.cuidador_telefone
  FROM chamadas c
  JOIN horarios h ON h.id = c.horario_id
  JOIN medicamentos m ON m.id = h.medicamento_id
  JOIN pacientes p ON p.id = m.paciente_id
  WHERE c.call_sid = ?
  ORDER BY m.nome
`);

function buscarItensPorIds(ids) {
  if (!ids.length) return [];
  const marcadores = ids.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT c.id, c.horario_id, c.data, c.tentativa, h.hora,
              m.nome AS medicamento, m.descricao,
              p.id AS paciente_id, p.nome AS paciente, p.telefone,
              p.cuidador_nome, p.cuidador_telefone
       FROM chamadas c
       JOIN horarios h ON h.id = c.horario_id
       JOIN medicamentos m ON m.id = h.medicamento_id
       JOIN pacientes p ON p.id = m.paciente_id
       WHERE c.id IN (${marcadores})
       ORDER BY m.nome`
    )
    .all(...ids);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// O call_sid é gravado logo depois que a Twilio aceita a ligação; espera um pouco caso o webhook chegue antes.
async function buscarItens(callSid) {
  if (!callSid) return [];
  for (let i = 0; i < 6; i++) {
    const itens = consultarPorCallSid.all(callSid);
    if (itens.length) return itens;
    await esperar(500);
  }
  return [];
}

function enviar(res, resposta) {
  res.type('text/xml').send(resposta.toString());
}

// Handler da rota de atendimento inicial com Speech-to-Text via Gather
async function atenderChamada(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  try {
    const callSid = req.body.CallSid;
    const tentativa = Number(req.query.t || 1);
    const itens = await buscarItens(callSid);
    const ids = itens.map((i) => i.id);
    const lista = ids.join(',');

    const queryIds = lista ? `?ids=${lista}&t=${tentativa}` : `?t=${tentativa}`;
    const actionUrl = `${config.baseUrl}/twilio/processar-resposta${queryIds}`;

    // Configuração do reconhecedor de voz
    const gather = twiml.gather({
      input: 'speech',
      language: 'pt-BR',
      speechTimeout: 'auto', // Aguarda a pausa natural na fala
      action: actionUrl, // Rota de destino do texto transcrito
      method: 'POST',
    });

    let mensagemVoz = 'Olá! Este é o sistema de cuidado. Você já tomou o seu remédio de agora? Responda sim, ou ainda não.';
    if (itens.length) {
      const { introducao, pergunta } = montarMensagem(itens[0].paciente, itens);
      mensagemVoz = `${introducao} ${pergunta} Responda sim, já tomei, ou ainda não.`;
    }

    // Mensagem sintética de saudação dentro do Gather
    gather.say(VOZ, mensagemVoz);

    // Fallback: se o idoso não falar nada em 5 segundos, a URA repete a pergunta
    if (tentativa < 2) {
      const fallbackUrl = `${config.baseUrl}/twilio/atendimento?ids=${lista}&t=${tentativa + 1}`;
      twiml.redirect({ method: 'POST' }, fallbackUrl);
    } else {
      // Ausência prolongada: direciona para o processamento sem resposta para acionar alerta
      const ausenciaUrl = `${config.baseUrl}/twilio/processar-resposta?ids=${lista}&ausencia=1`;
      twiml.redirect({ method: 'POST' }, ausenciaUrl);
    }

    enviar(res, twiml);
  } catch (e) {
    console.error('[twilio] erro no atendimento:', e);
    res.sendStatus(500);
  }
}

router.post('/atendimento', atenderChamada);
router.post('/voz', atenderChamada);

// Endpoint analítico de processamento da resposta transcrita
router.post('/processar-resposta', async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  try {
    // Captura o que a Twilio transcreveu
    const respostaFalada = req.body.SpeechResult ? req.body.SpeechResult.toLowerCase() : '';

    console.log(`[URA] O paciente respondeu: "${respostaFalada}"`);

    let ids = lerIds(req);
    let itens = ids.length ? buscarItensPorIds(ids) : [];
    if (!itens.length && req.body.CallSid) {
      itens = await buscarItens(req.body.CallSid);
      ids = itens.map((i) => i.id);
    }

    // Análise semântica primária
    if (respostaFalada.includes('sim') || respostaFalada.includes('já') || respostaFalada.includes('tomei')) {
      twiml.say(VOZ, 'Que excelente notícia! Seu registro foi atualizado. Tenha um ótimo dia!');

      // Atualiza no repositório SQLite marcando a medicação como confirmada
      if (ids.length) {
        atualizar(ids, 'confirmada');
        console.log(`[URA] Chamadas ${ids.join(',')} CONFIRMADAS no SQLite`);
      }
      twiml.hangup();
    } else {
      twiml.say(VOZ, 'Entendido. Estou enviando um aviso por mensagem para o seu cuidador.');

      // Marca como sem_resposta no SQLite
      if (ids.length) {
        atualizar(ids, 'sem_resposta');
        console.log(`[URA] Chamadas ${ids.join(',')} marcadas como sem_resposta`);
      }

      // Executa o disparo do alerta via SMS para o cuidador
      if (itens.length && itens[0].cuidador_telefone) {
        const paciente = itens[0];
        const remedios = itens.map((i) => i.medicamento).join(', ');
        const texto = `ALERTA: ${paciente.paciente} informou que não tomou o remédio (${remedios}). Resposta: "${respostaFalada || 'sem resposta'}". Por favor, entre em contato.`;
        try {
          await enviarAlerta({ para: paciente.cuidador_telefone, texto, canal: 'sms' });
          console.log(`[URA] Alerta via SMS enviado para ${paciente.cuidador_nome} (${paciente.cuidador_telefone})`);
        } catch (err) {
          console.error(`[URA] Falha ao enviar alerta via SMS: ${err.message}`);
        }
      }
      twiml.hangup();
    }
  } catch (e) {
    console.error('[URA] Erro em /processar-resposta:', e);
    twiml.say(VOZ, 'Desculpe, ocorreu um erro ao processar sua resposta.');
    twiml.hangup();
  }

  enviar(res, twiml);
});

// Rotas legadas para compatibilidade
router.post('/digito', (req, res) => {
  const ids = lerIds(req);
  const resposta = new twilio.twiml.VoiceResponse();

  if (req.body.Digits === '1') {
    atualizar(ids, 'confirmada');
    console.log(`[twilio] chamadas ${ids.join(',')} CONFIRMADAS`);
    resposta.say(VOZ, 'Obrigado! Confirmação recebida. Tenha um ótimo dia.');
  } else {
    atualizar(ids, 'sem_resposta');
    console.log(`[twilio] tecla ${req.body.Digits} não reconhecida (chamadas ${ids.join(',')})`);
    resposta.say(VOZ, 'Não entendi a tecla. Até logo.');
  }
  resposta.hangup();
  enviar(res, resposta);
});

router.post('/sem-digito', (req, res) => {
  const ids = lerIds(req);
  atualizar(ids, 'sem_resposta');
  console.log(`[twilio] atendeu mas não apertou nada -> chamadas ${ids.join(',')} sem_resposta`);
  const resposta = new twilio.twiml.VoiceResponse();
  resposta.say(VOZ, 'Não recebemos a sua resposta. Até logo.');
  resposta.hangup();
  enviar(res, resposta);
});

module.exports = router;
