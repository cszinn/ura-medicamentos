CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  cuidador_nome TEXT NOT NULL,
  cuidador_telefone TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS medicamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS horarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicamento_id INTEGER NOT NULL REFERENCES medicamentos(id) ON DELETE CASCADE,
  hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]' AND hora < '24:00'),
  dias_semana TEXT DEFAULT '0,1,2,3,4,5,6',
  data_inicio TEXT,
  data_fim TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  UNIQUE (medicamento_id, hora)
);

CREATE TABLE IF NOT EXISTS chamadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horario_id INTEGER NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  tentativa INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'discando'
    CHECK (status IN ('discando', 'confirmada', 'sem_resposta', 'falhou', 'escalonada')),
  call_sid TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (horario_id, data, tentativa)
);

CREATE INDEX IF NOT EXISTS idx_chamadas_call_sid ON chamadas(call_sid);
