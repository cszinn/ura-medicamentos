const path = require('path');
const express = require('express');
const config = require('./config');
const api = require('./routes/api');
const twilioRoutes = require('./routes/twilio');
const scheduler = require('./services/scheduler');
const escalonamento = require('./services/escalonamento');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', api);
app.use('/twilio', twilioRoutes);
app.use('/', twilioRoutes);

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido.' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.listen(config.port, () => {
  console.log(`Servidor em http://localhost:${config.port} (DRY_RUN=${config.dryRun})`);
  scheduler.iniciar();
  escalonamento.iniciar();
});
