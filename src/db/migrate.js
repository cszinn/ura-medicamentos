const db = require('./index');

console.log('Iniciando migração do banco de dados...');
try {
  db.exec(`
    ALTER TABLE horarios ADD COLUMN dias_semana TEXT DEFAULT '0,1,2,3,4,5,6';
    ALTER TABLE horarios ADD COLUMN data_inicio TEXT;
    ALTER TABLE horarios ADD COLUMN data_fim TEXT;
  `);
  console.log('Sucesso: Colunas de controle de dias e datas adicionadas à tabela horarios.');
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log('Aviso: As colunas já existem na tabela. Nenhuma alteração necessária.');
  } else {
    console.error('Erro na migração:', e.message);
  }
}
db.close();
