const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTel(t) {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(t);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : t;
}

function parseHorarios(txt) {
  const itens = (txt || '')
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((h) => (/^\d:\d{2}$/.test(h) ? '0' + h : h));
  return [...new Set(itens)];
}

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || 'Erro inesperado.');
  return data;
}

let pacientes = [];
let pacienteAtual = null;
let selecionadoId = null;

function avisar(msg, tipo = 'danger') {
  const el = $('#alerta');
  el.className = `alert alert-${tipo}`;
  el.textContent = msg;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => el.classList.add('d-none'), 5000);
}

const seguro = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    avisar(e.message);
  }
};

function fecharModal(id) {
  bootstrap.Modal.getInstance($('#' + id)).hide();
}

// ---------- renderização ----------

function renderLista() {
  const lista = $('#listaPacientes');
  if (!pacientes.length) {
    lista.innerHTML = '<div class="text-muted small">Nenhum paciente cadastrado.</div>';
    return;
  }
  lista.innerHTML = pacientes
    .map(
      (p) => `
      <button type="button" class="list-group-item list-group-item-action ${p.id === selecionadoId ? 'active' : ''}"
              data-acao="abrir" data-id="${p.id}">
        ${esc(p.nome)}
        ${p.ativo ? '' : '<span class="badge text-bg-secondary ms-1">pausado</span>'}
      </button>`
    )
    .join('');
}

function renderDetalhe(p) {
  pacienteAtual = p;

  const meds =
    p.medicamentos
      .map(
        (m) => `
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <h3 class="h6 mb-0">${esc(m.nome)}</h3>
              <p class="text-muted small mb-2">${esc(m.descricao)}</p>
            </div>
            <button class="btn btn-sm btn-outline-danger" data-acao="del-med" data-id="${m.id}">Remover</button>
          </div>
          <div class="mb-3">
            ${
              m.horarios
                .map(
                  (h) => `<span class="badge text-bg-primary me-1">${esc(h.hora)}
                    <button type="button" class="btn-close btn-close-white ms-1" style="font-size:.6rem"
                            data-acao="del-horario" data-id="${h.id}" aria-label="Remover horário"></button>
                  </span>`
                )
                .join('') || '<span class="text-muted small">Sem horários</span>'
            }
          </div>
          <div class="d-flex gap-2 align-items-center">
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirModalHorario(${m.id})">+ Adicionar Horário</button>
          </div>
        </div>
      </div>`
      )
      .join('') || '<p class="text-muted">Nenhum medicamento cadastrado.</p>';

  $('#detalhe').innerHTML = `
    <div class="card mb-4">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <h2 class="h5 mb-1">${esc(p.nome)}</h2>
            <div class="small text-muted">Telefone: ${esc(fmtTel(p.telefone))}</div>
            <div class="small text-muted">Cuidador: ${esc(p.cuidador_nome)} · ${esc(fmtTel(p.cuidador_telefone))}</div>
          </div>
          <div class="text-end">
            <div class="form-check form-switch d-inline-block mb-2">
              <input class="form-check-input" type="checkbox" id="swAtivo" data-acao="toggle-paciente" ${p.ativo ? 'checked' : ''}>
              <label class="form-check-label" for="swAtivo">Ligações ativas</label>
            </div><br>
            <button class="btn btn-sm btn-outline-danger" data-acao="del-paciente" data-id="${p.id}">Remover paciente</button>
          </div>
        </div>
      </div>
    </div>

    <div class="d-flex justify-content-between align-items-center mb-2">
      <h3 class="h5 mb-0">Medicamentos</h3>
      <button class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#modalMedicamento">+ Medicamento</button>
    </div>
    ${meds}`;

  const paciente = p;
  api(`/pacientes/${paciente.id}/chamadas`).then(chamadas => {
    const tbody = chamadas.map(c => `
      <tr>
        <td>${esc(c.criado_em)}</td>
        <td>${esc(c.medicamento)}</td>
        <td>${esc(c.hora)}</td>
        <td><span class="badge bg-${c.status === 'confirmada' ? 'success' : (c.status === 'discando' ? 'warning' : 'danger')}">${esc(c.status)}</span></td>
      </tr>
    `).join('');
    
    const painelStatus = `
      <div class="card mt-4 border-0 shadow-sm">
        <div class="card-body">
          <h5 class="card-title">Status Recentes das Ligações</h5>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr><th>Data/Hora</th><th>Remédio</th><th>Agendado</th><th>Status</th></tr></thead>
              <tbody>${tbody || '<tr><td colspan="4">Nenhuma chamada registrada.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    $('#detalhe').insertAdjacentHTML('beforeend', painelStatus);
  });
}

async function atualizar() {
  pacientes = await api('/pacientes');
  if (!pacientes.some((p) => p.id === selecionadoId)) selecionadoId = null;
  renderLista();
  if (selecionadoId) {
    renderDetalhe(await api(`/pacientes/${selecionadoId}`));
  } else {
    pacienteAtual = null;
    $('#detalhe').innerHTML = '<p class="text-muted">Selecione um paciente ou cadastre um novo.</p>';
  }
}

// ---------- eventos ----------

document.addEventListener(
  'click',
  seguro(async (ev) => {
    const el = ev.target.closest('[data-acao]');
    if (!el) return;
    const id = Number(el.dataset.id);

    switch (el.dataset.acao) {
      case 'abrir':
        selecionadoId = id;
        await atualizar();
        break;
      case 'del-paciente':
        if (!confirm('Remover este paciente, com todos os medicamentos e horários?')) return;
        await api(`/pacientes/${id}`, { method: 'DELETE' });
        selecionadoId = null;
        await atualizar();
        break;
      case 'del-med':
        if (!confirm('Remover este medicamento e seus horários?')) return;
        await api(`/medicamentos/${id}`, { method: 'DELETE' });
        await atualizar();
        break;
      case 'del-horario':
        await api(`/horarios/${id}`, { method: 'DELETE' });
        await atualizar();
        break;
    }
  })
);

document.addEventListener(
  'change',
  seguro(async (ev) => {
    const el = ev.target.closest('[data-acao="toggle-paciente"]');
    if (!el || !pacienteAtual) return;
    const p = pacienteAtual;
    await api(`/pacientes/${p.id}`, {
      method: 'PUT',
      body: {
        nome: p.nome,
        telefone: p.telefone,
        cuidador_nome: p.cuidador_nome,
        cuidador_telefone: p.cuidador_telefone,
        ativo: el.checked,
      },
    });
    await atualizar();
  })
);

document.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const dados = Object.fromEntries(new FormData(form));
  const erroEl = form.querySelector('.erro-form');

  try {
    if (form.id === 'formPaciente') {
      const novo = await api('/pacientes', { method: 'POST', body: dados });
      selecionadoId = novo.id;
      form.reset();
      fecharModal('modalPaciente');
    } else if (form.id === 'formMedicamento') {
      await api(`/pacientes/${selecionadoId}/medicamentos`, {
        method: 'POST',
        body: { nome: dados.nome, descricao: dados.descricao, horarios: parseHorarios(dados.horarios) },
      });
      form.reset();
      fecharModal('modalMedicamento');
    } else if (form.dataset.form === 'horario') {
      await api(`/medicamentos/${form.dataset.id}/horarios`, { method: 'POST', body: { hora: dados.hora } });
    }
    await atualizar();
  } catch (e) {
    if (erroEl) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('d-none');
    } else {
      avisar(e.message);
    }
  }
});

document.addEventListener('show.bs.modal', (ev) => {
  const erroEl = ev.target.querySelector('.erro-form');
  if (erroEl) erroEl.classList.add('d-none');
});

// Evento do formulário de Horários Específicos
$('#formHorario').addEventListener('submit', seguro(async (e) => {
  e.preventDefault();
  const medId = $('#horarioMedId').value;
  const diasSelecionados = Array.from($('#diasInput').selectedOptions).map(o => o.value).join(',');
  
  await api(`/medicamentos/${medId}/horarios`, {
    method: 'POST',
    body: {
      hora: $('#horaInput').value,
      dias_semana: diasSelecionados || '0,1,2,3,4,5,6',
      data_inicio: $('#dataInicioInput').value,
      data_fim: $('#dataFimInput').value
    }
  });
  fecharModal('modalHorario');
  avisar('Horário adicionado.');
  atualizar();
}));

// Função para popular o id oculto e abrir o modal de horário:
window.abrirModalHorario = (medId) => {
  $('#horarioMedId').value = medId;
  $('#formHorario').reset();
  new bootstrap.Modal($('#modalHorario')).show();
};

seguro(atualizar)();
