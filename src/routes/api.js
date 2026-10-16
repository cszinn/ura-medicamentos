const express = require('express');
const db = require('../db');
const { limpar, textoValido, normalizarTelefone, horaValida } = require('../validators');

const router = express.Router();

const erro = (res, status, mensagem) => res.status(status).json({ erro: mensagem });

router.param('id', (req, res, next, valor) => {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) return erro(res, 400, 'ID inválido.');
  req.id = id;
  next();
});

// ---------- helpers ----------

function lerAtivo(body, atual) {
  if (body.ativo === undefined) return atual;
  return body.ativo === true || body.ativo === 1 ? 1 : 0;
}

function lerPaciente(body) {
  const dados = {
    nome: limpar(body.nome),
    telefone: normalizarTelefone(body.telefone),
    cuidador_nome: limpar(body.cuidador_nome),
    cuidador_telefone: normalizarTelefone(body.cuidador_telefone),
  };
  if (!textoValido(dados.nome, 100)) return { mensagem: 'Informe o nome do paciente.' };
  if (!dados.telefone) return { mensagem: 'Telefone do paciente inválido. Use DDD + número, ex.: (31) 98888-7777.' };
  if (!textoValido(dados.cuidador_nome, 100)) return { mensagem: 'Informe o nome do cuidador.' };
  if (!dados.cuidador_telefone) return { mensagem: 'Telefone do cuidador inválido. Use DDD + número, ex.: (31) 97777-6666.' };
  return { dados };
}

function lerMedicamento(body) {
  const dados = { nome: limpar(body.nome), descricao: limpar(body.descricao) };
  if (!textoValido(dados.nome, 100)) return { mensagem: 'Informe o nome do medicamento.' };
  if (!textoValido(dados.descricao, 200)) return { mensagem: 'Informe a descrição amigável, ex.: o comprimido redondo e rosa.' };
  return { dados };
}

function montarMedicamento(id) {
  const med = db.prepare('SELECT * FROM medicamentos WHERE id = ?').get(id);
  if (!med) return null;
  med.horarios = db.prepare('SELECT * FROM horarios WHERE medicamento_id = ? ORDER BY hora').all(id);
  return med;
}

function montarPaciente(id) {
  const paciente = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
  if (!paciente) return null;
  const meds = db.prepare('SELECT * FROM medicamentos WHERE paciente_id = ? ORDER BY nome').all(id);
  const horarios = db
    .prepare(
      `SELECT h.* FROM horarios h
       JOIN medicamentos m ON m.id = h.medicamento_id
       WHERE m.paciente_id = ? ORDER BY h.hora`
    )
    .all(id);
  paciente.medicamentos = meds.map((m) => ({
    ...m,
    horarios: horarios.filter((h) => h.medicamento_id === m.id),
  }));
  return paciente;
}

function remover(tabela, rotulo) {
  return (req, res) => {
    const info = db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(req.id);
    if (info.changes === 0) return erro(res, 404, `${rotulo} não encontrado.`);
    res.status(204).end();
  };
}

// ---------- pacientes ----------

router.get('/pacientes', (req, res) => {
  res.json(db.prepare('SELECT * FROM pacientes ORDER BY nome').all());
});

router.get('/pacientes/:id', (req, res) => {
  const paciente = montarPaciente(req.id);
  if (!paciente) return erro(res, 404, 'Paciente não encontrado.');
  res.json(paciente);
});

router.post('/pacientes', (req, res) => {
  const { dados, mensagem } = lerPaciente(req.body || {});
  if (mensagem) return erro(res, 400, mensagem);
  const info = db
    .prepare(
      `INSERT INTO pacientes (nome, telefone, cuidador_nome, cuidador_telefone)
       VALUES (@nome, @telefone, @cuidador_nome, @cuidador_telefone)`
    )
    .run(dados);
  res.status(201).json(montarPaciente(info.lastInsertRowid));
});

router.put('/pacientes/:id', (req, res) => {
  const existente = db.prepare('SELECT ativo FROM pacientes WHERE id = ?').get(req.id);
  if (!existente) return erro(res, 404, 'Paciente não encontrado.');
  const body = req.body || {};
  const { dados, mensagem } = lerPaciente(body);
  if (mensagem) return erro(res, 400, mensagem);
  dados.ativo = lerAtivo(body, existente.ativo);
  dados.id = req.id;
  db.prepare(
    `UPDATE pacientes SET nome=@nome, telefone=@telefone, cuidador_nome=@cuidador_nome,
     cuidador_telefone=@cuidador_telefone, ativo=@ativo WHERE id=@id`
  ).run(dados);
  res.json(montarPaciente(req.id));
});

router.delete('/pacientes/:id', remover('pacientes', 'Paciente'));

// ---------- medicamentos ----------

router.post('/pacientes/:id/medicamentos', (req, res) => {
  if (!db.prepare('SELECT 1 FROM pacientes WHERE id = ?').get(req.id)) {
    return erro(res, 404, 'Paciente não encontrado.');
  }
  const body = req.body || {};
  const { dados, mensagem } = lerMedicamento(body);
  if (mensagem) return erro(res, 400, mensagem);

  const horarios = body.horarios === undefined ? [] : body.horarios;
  if (!Array.isArray(horarios) || !horarios.every((h) => horaValida(h))) {
    return erro(res, 400, 'Horários inválidos. Use o formato HH:MM, ex.: 08:00.');
  }

  const criar = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO medicamentos (paciente_id, nome, descricao) VALUES (?, ?, ?)')
      .run(req.id, dados.nome, dados.descricao);
    const inserir = db.prepare('INSERT INTO horarios (medicamento_id, hora) VALUES (?, ?)');
    [...new Set(horarios)].forEach((h) => inserir.run(info.lastInsertRowid, h));
    return info.lastInsertRowid;
  });

  res.status(201).json(montarMedicamento(criar()));
});

router.put('/medicamentos/:id', (req, res) => {
  const existente = db.prepare('SELECT ativo FROM medicamentos WHERE id = ?').get(req.id);
  if (!existente) return erro(res, 404, 'Medicamento não encontrado.');
  const body = req.body || {};
  const { dados, mensagem } = lerMedicamento(body);
  if (mensagem) return erro(res, 400, mensagem);
  dados.ativo = lerAtivo(body, existente.ativo);
  dados.id = req.id;
  db.prepare('UPDATE medicamentos SET nome=@nome, descricao=@descricao, ativo=@ativo WHERE id=@id').run(dados);
  res.json(montarMedicamento(req.id));
});

router.delete('/medicamentos/:id', remover('medicamentos', 'Medicamento'));

// ---------- horários ----------

router.post('/medicamentos/:id/horarios', (req, res) => {
  if (!db.prepare('SELECT 1 FROM medicamentos WHERE id = ?').get(req.id)) {
    return erro(res, 404, 'Medicamento não encontrado.');
  }
  const body = req.body || {};
  const hora = limpar(body.hora);
  const dias = limpar(body.dias_semana) || '0,1,2,3,4,5,6';
  const inicio = limpar(body.data_inicio) || null;
  const fim = limpar(body.data_fim) || null;

  if (!horaValida(hora)) return erro(res, 400, 'Horário inválido.');

  try {
    const info = db.prepare(`
      INSERT INTO horarios (medicamento_id, hora, dias_semana, data_inicio, data_fim) 
      VALUES (?, ?, ?, ?, ?)
    `).run(req.id, hora, dias, inicio, fim);
    res.status(201).json(db.prepare('SELECT * FROM horarios WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return erro(res, 409, 'Esse horário já existe para este medicamento.');
    }
    throw e;
  }
});

router.delete('/horarios/:id', remover('horarios', 'Horário'));

// Nova Rota: Histórico de chamadas do paciente
router.get('/pacientes/:id/chamadas', (req, res) => {
  const chamadas = db.prepare(`
    SELECT c.data, c.tentativa, c.status, c.criado_em, h.hora, m.nome as medicamento
    FROM chamadas c
    JOIN horarios h ON c.horario_id = h.id
    JOIN medicamentos m ON h.medicamento_id = m.id
    WHERE m.paciente_id = ?
    ORDER BY c.criado_em DESC
    LIMIT 20
  `).all(req.params.id);
  res.json(chamadas);
});

router.use((req, res) => erro(res, 404, 'Rota não encontrada.'));

module.exports = router;
