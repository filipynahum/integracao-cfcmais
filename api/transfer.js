// api/transfer.js

// Importe a biblioteca para fazer requisições HTTP (fetch é nativo no Node.js moderno)
// Se estiver em uma versão mais antiga do Node.js ou preferir, pode instalar 'axios': npm install axios
// const axios = require('axios'); // Descomente se for usar axios
const fetch = require('node-fetch'); // Necessário para Node.js < 18, senão fetch é global

// Seu Bearer Token do Z-Pro
const ZPRO_BEARER_TOKEN = process.env.ZPRO_BEARER_TOKEN; // Usaremos variáveis de ambiente!

// URLs das APIs do Z-Pro
const ZPRO_BASE_URL = 'https://backend.cfcmais.com.br/v2/api/external/6c969e8a-b200-49af-97fc-fbd223267d48';
const SHOW_CONTACT_URL = `${ZPRO_BASE_URL}/showcontact`;
const UPDATE_QUEUE_URL = `${ZPRO_BASE_URL}/updatequeue`;

// Fila de destino para matrícula
const MATRICULA_QUEUE_ID = 5;

// Função auxiliar para fazer requisições POST ao Z-Pro
async function callZProApi(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZPRO_BEARER_TOKEN}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Erro na API Z-Pro (${url}):`, response.status, data);
      throw new Error(`Erro na API Z-Pro: ${data.message || response.statusText}`);
    }

    return data;
  } catch (error) {
    console.error(`Exceção ao chamar ${url}:`, error);
    throw error;
  }
}

// Função para encontrar o ticket ID ativo
function findActiveTicketId(contactData) {
  if (!contactData || !contactData.tickets || contactData.tickets.length === 0) {
    return null;
  }

  // Prioridade 1: status "open" e isActiveDemand "true"
  let activeTicket = contactData.tickets.find(
    ticket => ticket.status === 'open' && ticket.isActiveDemand === true
  );

  if (activeTicket) {
    return activeTicket.id;
  }

  // Prioridade 2: apenas status "open"
  activeTicket = contactData.tickets.find(ticket => ticket.status === 'open');
  if (activeTicket) {
    return activeTicket.id;
  }

  // Prioridade 3: ticket mais recente (com o updatedAt mais alto)
  // Certifique-se de que updatedAt é uma string de data válida
  const sortedTickets = contactData.tickets.sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt);
    const dateB = new Date(b.updatedAt || b.createdAt);
    return dateB.getTime() - dateA.getTime();
  });

  if (sortedTickets.length > 0) {
    return sortedTickets[0].id;
  }

  return null; // Nenhum ticket ativo encontrado
}

// Handler da API Vercel
module.exports = async (req, res) => {
  // A Vercel permite métodos diferentes, mas para tool calls, geralmente é POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Verifique se o Bearer Token está configurado
  if (!ZPRO_BEARER_TOKEN) {
    console.error('Erro: Variável de ambiente ZPRO_BEARER_TOKEN não configurada.');
    return res.status(500).json({ error: 'Server configuration error: ZPRO_BEARER_TOKEN is missing.' });
  }

  try {
    const { function: { arguments: { phone_number } } } = req.body;

    if (!phone_number) {
      return res.status(400).json({ error: 'Missing phone_number in request arguments.' });
    }

    console.log(`Recebida requisição para transferir número: ${phone_number}`);

    // 1. Chamar showcontact para obter o ticketId
    console.log(`Chamando ${SHOW_CONTACT_URL} para o número: ${phone_number}`);
    const contactData = await callZProApi(SHOW_CONTACT_URL, { number: phone_number });
    console.log('Resposta de showcontact:', JSON.stringify(contactData, null, 2));

    const ticketId = findActiveTicketId(contactData);

    if (!ticketId) {
      console.warn(`Nenhum ticket ativo encontrado para o número: ${phone_number}`);
      return res.status(404).json({ error: 'No active ticket found for this phone number.' });
    }

    console.log(`Ticket ID encontrado para transferência: ${ticketId}`);

    // 2. Chamar updatequeue para transferir o atendimento
    console.log(`Chamando ${UPDATE_QUEUE_URL} para ticketId: ${ticketId}, queueId: ${MATRICULA_QUEUE_ID}`);
    const updateQueueResponse = await callZProApi(UPDATE_QUEUE_URL, {
      ticketId: ticketId,
      queueId: MATRICULA_QUEUE_ID
    });
    console.log('Resposta de updatequeue:', JSON.stringify(updateQueueResponse, null, 2));

    // Sucesso! Retorne uma resposta para o OpenAI.
    res.status(200).json({
      success: true,
      message: `Atendimento transferido para a fila ${MATRICULA_QUEUE_ID}.`,
      ticketId: ticketId
    });

  } catch (error) {
    console.error('Erro no handler da API:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to transfer chat.',
      details: error.message
    });
  }
};
