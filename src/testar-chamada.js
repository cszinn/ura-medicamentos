require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

client.calls.create({
    url: 'https://pond-irritate-trowel.ngrok-free.dev/twilio/atendimento',
    to: '+5531997731873',
    from: process.env.TWILIO_PHONE_NUMBER
})
.then(call => console.log('Chamada iniciada com sucesso! SID:', call.sid))
.catch(error => console.error('Erro ao iniciar a chamada:', error));
