const config = require('../config');
const { getClient } = require('./twilioClient');

// Envia o alerta ao cuidador por SMS (padrão) ou WhatsApp (ALERTA_CANAL=whatsapp).
async function enviarAlerta({ para, texto, canal }) {
  const tipoCanal = canal || config.alerta.canal;
  const whats = tipoCanal === 'whatsapp';

  if (config.dryRun) {
    console.log(`  [SIMULADO] alerta (${tipoCanal}) para ${para}: "${texto}"`);
    return { sid: `DRY-MSG-${Date.now()}` };
  }

  const msg = await getClient().messages.create({
    to: whats ? `whatsapp:${para}` : para,
    from: whats ? `whatsapp:${config.alerta.whatsappFrom}` : config.twilio.phoneNumber,
    body: texto,
  });
  return { sid: msg.sid };
}

module.exports = { enviarAlerta };
