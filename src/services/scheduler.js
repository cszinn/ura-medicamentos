const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const { montarMensagem } = require('./mensagem');
const { discar } = require('./telephony');

const buscarDevidos = db.prepare(`
  SELECT h.id AS horario_id, h.hora, h.dias_semana,
         m.nome AS medicamento, m.descricao,
         p.id AS paciente_id, p.nome AS paciente, p.telefone,
         p.cuidador_nome, p.cuidador_telefone
  FROM horarios h
  JOIN medicamentos m ON m.id = h.medicamento_id AND m.ativo = 1
  JOIN pacientes p ON p.id = m.paciente_id AND p.ativo = 1
  WHERE h.ativo = 1 
    AND h.hora = ?
    AND (h.dias_semana IS NULL OR h.dias_semana LIKE '%' || ? || '%')
    AND (h.data_inicio IS NULL OR h.data_inicio = '' OR h.data_inicio <= ?)
    AND (h.data_fim IS NULL OR h.data_fim = '' OR h.data_fim >= ?)
  ORDER BY p.id, m.nome
`);

function agora(date = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const dataHoje = `${p.year}-${p.month}-${p.day}`;
  
  // Obter o dia da semana considerando o fuso horário (0 = Domingo, 6 = Sábado)
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: config.timezone }));
  const diaSemana = tzDate.getDay().toString();

  return { data: dataHoje, hora: `${p.hour}:${p.minute}`, diaSemana };
}

const reservar = db.prepare(
  'INSERT OR IGNORE INTO chamadas (horario_id, data, tentativa) VALUES (?, ?, 1)'
);

async function ligar(itens, hora) {
  const paciente = { nome: itens[0].paciente, telefone: itens[0].telefone };
  const ids = itens.map((i) => i.chamada_id);
  const marcadores = ids.map(() => '?').join(',');

  console.log(`[${hora}] ${itens.length} medicamento(s) para ${paciente.nome}`);
  try {
    const { callSid } = await discar({
      paciente,
      mensagem: montarMensagem(paciente.nome, itens),
      chamadaIds: ids,
    });
    db.prepare(
      `UPDATE chamadas SET call_sid = ?, atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores})`
    ).run(callSid, ...ids);
  } catch (e) {
    console.error(`  Falha ao discar: ${e.message}`);
    db.prepare(
      `UPDATE chamadas SET status = 'falhou', atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores})`
    ).run(...ids);
  }
}

// Varre o banco para o minuto informado (padrão: agora). Retorna quantas chamadas foram reservadas.
async function varrer({ data, hora, diaSemana } = agora()) {
  const devidos = buscarDevidos.all(hora, diaSemana, data, data);

  const novos = [];
  db.transaction(() => {
    for (const d of devidos) {
      const info = reservar.run(d.horario_id, data);
      if (info.changes === 1) novos.push({ ...d, chamada_id: info.lastInsertRowid });
    }
  })();

  const porPaciente = new Map();
  for (const n of novos) {
    if (!porPaciente.has(n.paciente_id)) porPaciente.set(n.paciente_id, []);
    porPaciente.get(n.paciente_id).push(n);
  }

  for (const itens of porPaciente.values()) {
    await ligar(itens, hora);
  }
  return novos.length;
}

function iniciar() {
  cron.schedule(
    '* * * * *',
    async () => {
      try {
        await varrer();
      } catch (e) {
        console.error('Erro na varredura:', e);
      }
    },
    { timezone: config.timezone }
  );
  console.log(`Agendador ativo (varredura a cada minuto, fuso ${config.timezone})`);
}

module.exports = { iniciar, varrer, agora, ligar };
