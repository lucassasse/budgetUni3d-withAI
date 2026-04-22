/* ============================================================
   UNI3D — SISTEMA DE ORÇAMENTOS
   app.js — lógica principal
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTES & ESTADO GLOBAL
// ============================================================
const STORAGE_KEY   = 'uni3d_orcamento';
const HISTORICO_KEY = 'uni3d_historicos';
const MATERIAIS_CONHECIDOS = ['PLA', 'ABS', 'PETG', 'TPU', 'ASA', 'Resina'];

/** @type {{ budgetId: string, createdAt: string, client: {nome: string, whatsapp: string}, items: Array }} */
let state = criarNovoEstado();

// Logo pré-carregada como base64 para uso no PDF
let _logoDataUrl   = null;
let _logoRatio     = 1;

function criarNovoEstado() {
    return {
        budgetId:  gerarBudgetId(),
        createdAt: new Date().toISOString(),
        client:    { nome: '', whatsapp: '' },
        items:     [],
        desconto:  { ativo: true, tipo: 'porcentagem', valor: 0 }
    };
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    precarregarLogo();
    carregarEstado();
    vincularEventos();
    renderizar();
});

function precarregarLogo() {
    fetch('logo-sem-fundo.png')
        .then(r => r.blob())
        .then(blob => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        }))
        .then(dataUrl => {
            _logoDataUrl = dataUrl;
            const img = new Image();
            img.onload = () => { _logoRatio = img.naturalWidth / img.naturalHeight; };
            img.src = dataUrl;
        })
        .catch(() => { /* imagem indisponível: PDF usará texto */ });
}

// ============================================================
// PERSISTÊNCIA (localStorage)
// ============================================================
function carregarEstado() {
    try {
        const salvo = localStorage.getItem(STORAGE_KEY);
        if (salvo) {
            state = JSON.parse(salvo);
            if (!state.desconto) state.desconto = { ativo: true, tipo: 'porcentagem', valor: 0 };
            state.desconto.ativo = true;
        }
    } catch (e) {
        console.warn('Não foi possível carregar dados salvos:', e);
    }
}

function salvarEstado() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const historico = carregarHistorico();
    historico[state.budgetId] = state;
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
}

function carregarHistorico() {
    try {
        const raw = localStorage.getItem(HISTORICO_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { /* */ }
    return {};
}

function removerDoHistorico(budgetId) {
    const historico = carregarHistorico();
    delete historico[budgetId];
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
}

// ============================================================
// GERAÇÃO DE ID ÚNICO
// ============================================================
function gerarBudgetId() {
    // Usa chars sem ambiguidade visual (sem 0/O, 1/I, etc.)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return 'UNI-' + id;
}

// ============================================================
// VINCULAÇÃO DE EVENTOS
// ============================================================
function vincularEventos() {

    // Formulário de item
    document.getElementById('item-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-edit-btn').addEventListener('click', resetarFormulario);

    // Máscara de preço
    document.getElementById('item-preco').addEventListener('input', handleMascaraPreco);

    // Dados do cliente — salvos em tempo real
    document.getElementById('client-name').addEventListener('input', (e) => {
        state.client.nome = e.target.value;
        salvarEstado();
        atualizarResumo();
    });

    document.getElementById('client-whatsapp').addEventListener('input', handleMascaraWhatsApp);

    // Copiar código do orçamento
    document.getElementById('copy-code-btn').addEventListener('click', copiarCodigo);

    // Exportar PDF
    document.getElementById('export-pdf-btn').addEventListener('click', exportarPDF);

    // Listar orçamentos
    document.getElementById('listar-btn').addEventListener('click', abrirListaModal);
    document.getElementById('lista-close-btn').addEventListener('click', fecharListaModal);
    document.getElementById('lista-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) fecharListaModal();
    });
    document.getElementById('lista-search').addEventListener('input', (e) => {
        renderizarLista(e.target.value.trim());
    });

    // Limpar orçamento
    document.getElementById('clear-btn').addEventListener('click', () => {
        mostrarModal(
            '⚠️',
            'Limpar Orçamento',
            'Tem certeza? Todos os dados do cliente e itens serão removidos e um novo orçamento será criado.',
            limparOrcamento
        );
    });

    // Desconto
    document.querySelectorAll('input[name="desconto-tipo"]').forEach(r => r.addEventListener('change', handleDescontoTipo));
    document.getElementById('desconto-valor').addEventListener('input', handleDescontoValor);

    // Inicializa campo de material múltiplo
    resetarMateriais();

    document.getElementById('modal-cancel').addEventListener('click', fecharModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) fecharModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            fecharModal();
            fecharListaModal();
        }
    });
}

// ============================================================
// HANDLERS DO FORMULÁRIO
// ============================================================
function handleFormSubmit(e) {
    e.preventDefault();

    // Coleta de valores
    const produto   = document.getElementById('item-produto').value.trim();
    const materiais = coletarMateriais();
    const cor       = document.getElementById('item-cor').value.trim();
    const precoRaw  = document.getElementById('item-preco').value;
    const preco     = parsearPreco(precoRaw);
    const editId    = document.getElementById('edit-id').value;

    // Validação
    let erros = [];
    if (!produto)            erros.push('Produto é obrigatório.');
    if (materiais.length === 0) erros.push('Selecione pelo menos um material.');
    if (!cor)                erros.push('Cor é obrigatória.');
    if (preco <= 0)          erros.push('Informe um preço válido.');

    if (erros.length > 0) {
        mostrarToast(erros[0], 'error');
        return;
    }

    if (editId) {
        // Atualizar item existente
        const idx = state.items.findIndex(i => i.id === editId);
        if (idx !== -1) {
            state.items[idx] = { ...state.items[idx], produto, materiais, cor, preco };
        }
        mostrarToast('Item atualizado com sucesso!', 'success');
    } else {
        // Novo item
        state.items.push({ id: gerarIdItem(), produto, materiais, cor, preco });
        mostrarToast('Item adicionado!', 'success');
    }

    salvarEstado();
    resetarFormulario();
    renderizarItens();
    atualizarResumo();
}

function handleMascaraPreco(e) {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) { e.target.value = ''; return; }
    const num = parseInt(raw, 10) / 100;
    e.target.value = formatarPreco(num);
    // Mantém cursor no final
    const len = e.target.value.length;
    e.target.setSelectionRange(len, len);
}

function handleMascaraWhatsApp(e) {
    let v = e.target.value.replace(/\D/g, '').slice(0, 11);
    if      (v.length > 10) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
    else if (v.length > 6)  v = `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
    else if (v.length > 2)  v = `(${v.slice(0,2)}) ${v.slice(2)}`;
    e.target.value = v;
    state.client.whatsapp = v;
    salvarEstado();
}

// ============================================================
// AÇÕES DE ITEM (editar / excluir)
// ============================================================
function editarItem(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    document.getElementById('edit-id').value  = item.id;
    document.getElementById('item-produto').value = item.produto;
    document.getElementById('item-cor').value     = item.cor;
    document.getElementById('item-preco').value   = formatarPreco(item.preco);

    // Preenche materiais
    preencherMateriais(getMateriais(item));

    // Atualiza botão e título
    document.getElementById('form-title').textContent = 'Editar Item';
    document.getElementById('submit-btn').innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
        </svg>
        Salvar Alterações
    `;
    document.getElementById('cancel-edit-btn').classList.remove('hidden');

    // Marca item como em edição
    document.querySelectorAll('.item-card').forEach(el => el.classList.remove('editing'));
    const card = document.querySelector(`.item-card[data-id="${id}"]`);
    if (card) card.classList.add('editing');

    // Scroll suave para o formulário
    document.getElementById('item-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function excluirItem(id) {
    const item = state.items.find(i => i.id === id);
    const nome = item ? `"${item.produto}"` : 'este item';
    mostrarModal(
        '🗑️',
        'Excluir Item',
        `Deseja remover ${nome} do orçamento?`,
        () => {
            state.items = state.items.filter(i => i.id !== id);
            salvarEstado();
            renderizarItens();
            atualizarResumo();
            mostrarToast('Item removido.', 'info');
        }
    );
}

// ============================================================
// LIMPAR ORÇAMENTO
// ============================================================
function limparOrcamento() {
    state = criarNovoEstado();
    salvarEstado();
    resetarFormulario();
    document.getElementById('client-name').value    = '';
    document.getElementById('client-whatsapp').value = '';
    renderizar();
    mostrarToast('Orçamento limpo! Novo código gerado.', 'info');
}

// ============================================================
// COPIAR CÓDIGO
// ============================================================
function copiarCodigo() {
    const codigo = state.budgetId;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(codigo).then(() => mostrarToast('Código copiado!', 'success'));
    } else {
        mostrarToast('Código: ' + codigo, 'info');
    }
}

// ============================================================
// EXPORTAR PDF
// ============================================================
function exportarPDF() {
    gerarPDF(state);
}

function gerarPDF(budget) {
    if (!window.jspdf) {
        mostrarToast('Biblioteca PDF não carregada. Verifique sua conexão.', 'error');
        return;
    }
    if (!budget.items || budget.items.length === 0) {
        mostrarToast('O orçamento não possui itens para exportar.', 'error');
        return;
    }
    if (!budget.client || !budget.client.nome.trim()) {
        mostrarToast('O orçamento não possui nome de cliente.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const mL = 18, mR = 18;
    const cW = pageW - mL - mR;

    // ── CABEÇALHO (fundo gradiente simulado) ──────────────────
    doc.setFillColor(11, 60, 93);
    doc.rect(0, 0, pageW, 42, 'F');
    doc.setFillColor(47, 164, 231);
    doc.triangle(pageW - 60, 0, pageW, 0, pageW, 42, 'F');

    if (_logoDataUrl) {
        const logoH = 34;
        const logoW = logoH * _logoRatio;
        const logoY = (42 - logoH) / 2;
        doc.addImage(_logoDataUrl, 'PNG', mL, logoY, logoW, logoH);
    } else {
        _renderNomeHeader(doc, mL);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('ORÇAMENTO', pageW - mR, 14, { align: 'right' });
    doc.setFontSize(13);
    doc.text('#' + budget.budgetId, pageW - mR, 22, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const dtCriacao = new Date(budget.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    doc.text('Data: ' + dtCriacao, pageW - mR, 29, { align: 'right' });

    let y = 52;

    // ── DADOS DO CLIENTE ─────────────────────────────────────
    doc.setFillColor(208, 235, 250);
    doc.roundedRect(mL, y, cW, budget.client.whatsapp ? 26 : 18, 3, 3, 'F');
    doc.setDrawColor(47, 164, 231);
    doc.roundedRect(mL, y, cW, budget.client.whatsapp ? 26 : 18, 3, 3, 'S');

    doc.setTextColor(11, 60, 93);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('DADOS DO CLIENTE', mL + 6, y + 6);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(budget.client.nome, mL + 6, y + 13);

    if (budget.client.whatsapp) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('WhatsApp: ' + budget.client.whatsapp, mL + 6, y + 20);
    }

    y += (budget.client.whatsapp ? 26 : 18) + 10;

    // ── TABELA DE ITENS ───────────────────────────────────────
    doc.setTextColor(11, 60, 93);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('ITENS DO ORÇAMENTO', mL, y);
    y += 4;

    const linhas = budget.items.map((item, idx) => [
        (idx + 1).toString(),
        item.produto,
        getMateriais(item).join(' + '),
        item.cor,
        formatarPreco(item.preco)
    ]);

    doc.autoTable({
        startY: y,
        head: [['#', 'Produto', 'Material', 'Cor', 'Preço']],
        body: linhas,
        margin: { left: mL, right: mR },
        styles: { fontSize: 9, cellPadding: 3, valign: 'middle' },
        headStyles: {
            fillColor: [11, 60, 93],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8.5
        },
        alternateRowStyles: { fillColor: [240, 249, 255] },
        columnStyles: {
            0: { cellWidth: 9,  halign: 'center', fontStyle: 'bold' },
            2: { cellWidth: 22 },
            3: { cellWidth: 24 },
            4: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: [11, 60, 93] }
        }
    });

    y = doc.lastAutoTable.finalY + 6;

    // ── DESCONTO + TOTAL ──────────────────────────────────────
    const subtotal      = budget.items.reduce((s, i) => s + i.preco, 0);
    const descontoValor = calcularDescontoEm(budget, subtotal);
    const total         = subtotal - descontoValor;

    if (descontoValor > 0) {
        const labelDesc = budget.desconto.tipo === 'porcentagem'
            ? `Desconto (${budget.desconto.valor}%):`
            : 'Desconto:';

        doc.setTextColor(71, 85, 105);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.text('Subtotal:', pageW - mR - 58, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.text(formatarPreco(subtotal), pageW - mR, y + 5, { align: 'right' });

        doc.setTextColor(220, 38, 38);
        doc.setFont('helvetica', 'normal');
        doc.text(labelDesc, pageW - mR - 58, y + 11);
        doc.setFont('helvetica', 'bold');
        doc.text(`-${formatarPreco(descontoValor)}`, pageW - mR, y + 11, { align: 'right' });

        y += 16;
    }

    const boxW = 38, boxH = 9, boxX = pageW - mR - boxW;

    doc.setTextColor(11, 60, 93);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('VALOR TOTAL', boxX - 113, y + boxH / 2 + 1.5, { align: 'right' });

    doc.setFillColor(255, 106, 0);
    doc.roundedRect(boxX, y, boxW, boxH, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(formatarPreco(total), boxX + boxW / 2, y + boxH / 2 + 1.2, { align: 'center' });

    // ── RODAPÉ ───────────────────────────────────────────────
    doc.setTextColor(160, 174, 192);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Uni3D — Impressão 3D', pageW / 2, pageH - 9, { align: 'center' });
    doc.text(
        `Orçamento #${budget.budgetId} · Gerado em ${new Date().toLocaleString('pt-BR')}`,
        pageW / 2, pageH - 5, { align: 'center' }
    );

    // ── VALIDADE ──────────────────────────────────────────────
    const validY = pageH - 26;
    doc.setFillColor(255, 248, 208);
    doc.roundedRect(mL, validY, cW, 10, 2.5, 2.5, 'F');
    doc.setDrawColor(255, 195, 0);
    doc.setLineWidth(0.5);
    doc.roundedRect(mL, validY, cW, 10, 2.5, 2.5, 'S');
    doc.setTextColor(122, 80, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Este orçamento é válido por 7 dias.', pageW / 2, validY + 6.8, { align: 'center' });

    const nomeArq = sanitizarNomeArquivo(budget.client.nome) + '_' + budget.budgetId + '.pdf';
    doc.save(nomeArq);
    mostrarToast('PDF gerado: ' + nomeArq, 'success');
}

function _renderNomeHeader(doc, mL) {
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Uni3D', mL, 23);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Impressão 3D', mL, 30);
}

// ============================================================
// RENDER PRINCIPAL
// ============================================================
function renderizar() {
    sincronizarCabecalho();
    renderizarItens();
    atualizarResumo();
    sincronizarCamposCliente();
    sincronizarDesconto();
}

function sincronizarCabecalho() {
    const codigo = '#' + state.budgetId;
    document.getElementById('budget-code').textContent  = codigo;
    document.getElementById('summary-code').textContent = codigo;
}

function sincronizarCamposCliente() {
    document.getElementById('client-name').value     = state.client.nome;
    document.getElementById('client-whatsapp').value = state.client.whatsapp;
}

function renderizarItens() {
    const lista = document.getElementById('items-list');
    const badge = document.getElementById('item-count-badge');

    badge.textContent = state.items.length;

    if (state.items.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <p>Nenhum item adicionado ainda.</p>
                <p class="empty-hint">Use o formulário ao lado para inserir produtos.</p>
            </div>`;
        return;
    }

    lista.innerHTML = state.items.map((item, idx) => `
        <div class="item-card" data-id="${item.id}">
            <div class="item-num">${idx + 1}</div>
            <div class="item-body">
                <div class="item-name" title="${escapeHtml(item.produto)}">${escapeHtml(item.produto)}</div>
                <div class="item-tags">
                    ${getMateriais(item).map(m => `<span class="tag">${escapeHtml(m)}</span>`).join('')}
                    <span class="tag tag-cor">${escapeHtml(item.cor)}</span>
                </div>
                <div class="item-price">${formatarPreco(item.preco)}</div>
            </div>
            <div class="item-btns">
                <button class="btn-icon btn-edit-item" onclick="editarItem('${item.id}')" title="Editar item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-icon btn-del-item" onclick="excluirItem('${item.id}')" title="Excluir item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/>
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

function calcularDesconto(subtotal) {
    if (!state.desconto.ativo || state.desconto.valor <= 0) return 0;
    if (state.desconto.tipo === 'porcentagem') return subtotal * (state.desconto.valor / 100);
    return Math.min(state.desconto.valor, subtotal);
}

function atualizarResumo() {
    const subtotal      = state.items.reduce((s, i) => s + i.preco, 0);
    const descontoValor = calcularDesconto(subtotal);
    const total         = subtotal - descontoValor;

    const nome = state.client.nome;
    document.getElementById('summary-client').textContent = nome
        ? (nome.length > 15 ? nome.slice(0, 15) + '…' : nome)
        : '—';
    document.getElementById('summary-count').textContent  = state.items.length;
    document.getElementById('summary-total').textContent  = formatarPreco(total);

    document.getElementById('summary-subtotal').textContent = formatarPreco(subtotal);
    document.getElementById('summary-desconto').textContent = descontoValor > 0
        ? (state.desconto.tipo === 'porcentagem'
            ? `−${state.desconto.valor}% (${formatarPreco(descontoValor)})`
            : `−${formatarPreco(descontoValor)}`)
        : '—';
}

function sincronizarDesconto() {
    const d = state.desconto;
    document.getElementById('desconto-tipo-pct').checked  = d.tipo === 'porcentagem';
    document.getElementById('desconto-tipo-fixo').checked = d.tipo === 'fixo';
    const input = document.getElementById('desconto-valor');
    const unidade = document.getElementById('desconto-unidade');
    if (d.tipo === 'porcentagem') {
        input.placeholder = '0';
        unidade.textContent = '%';
        input.value = d.valor > 0 ? String(d.valor) : '';
    } else {
        input.placeholder = 'R$ 0,00';
        unidade.textContent = 'R$';
        input.value = d.valor > 0 ? formatarPreco(d.valor) : '';
    }
}


function handleDescontoTipo(e) {
    state.desconto.tipo  = e.target.value;
    state.desconto.valor = 0;
    const input   = document.getElementById('desconto-valor');
    const unidade = document.getElementById('desconto-unidade');
    input.value = '';
    if (e.target.value === 'porcentagem') {
        input.placeholder   = '0';
        unidade.textContent = '%';
    } else {
        input.placeholder   = 'R$ 0,00';
        unidade.textContent = 'R$';
    }
    salvarEstado();
    atualizarResumo();
}

function handleDescontoValor(e) {
    if (state.desconto.tipo === 'porcentagem') {
        const raw = e.target.value.replace(/[^0-9,\.]/g, '').replace(',', '.');
        const num = parseFloat(raw);
        state.desconto.valor = isNaN(num) ? 0 : Math.min(Math.max(num, 0), 100);
        e.target.value = raw;
    } else {
        const raw = e.target.value.replace(/\D/g, '');
        if (!raw) { e.target.value = ''; state.desconto.valor = 0; }
        else {
            const num = parseInt(raw, 10) / 100;
            e.target.value       = formatarPreco(num);
            state.desconto.valor = num;
            const len = e.target.value.length;
            e.target.setSelectionRange(len, len);
        }
    }
    salvarEstado();
    atualizarResumo();
}

// ============================================================
// RESET DO FORMULÁRIO
// ============================================================
function resetarFormulario() {
    document.getElementById('item-form').reset();
    document.getElementById('edit-id').value = '';
    resetarMateriais();
    document.getElementById('cancel-edit-btn').classList.add('hidden');
    document.getElementById('form-title').textContent = 'Adicionar Item';
    document.getElementById('submit-btn').innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Adicionar Item
    `;
    document.querySelectorAll('.item-card').forEach(el => el.classList.remove('editing'));
}

// ============================================================
// MATERIAL MÚLTIPLO
// ============================================================
function _opcoesMaterialHtml(valorSelecionado) {
    const opts = [...MATERIAIS_CONHECIDOS, 'Outro'];
    return '<option value="">Selecione o material...</option>' +
        opts.map(o => `<option value="${o}"${o === valorSelecionado ? ' selected' : ''}>${o === 'Outro' ? 'Outro...' : o}</option>`).join('');
}

function _appendLinhaMateria(container, isFirst, valor) {
    const row = document.createElement('div');
    row.className = 'material-row';

    let selectVal = '';
    let outroVal  = '';
    if (valor) {
        if (MATERIAIS_CONHECIDOS.includes(valor)) {
            selectVal = valor;
        } else {
            selectVal = 'Outro';
            outroVal  = valor;
        }
    }

    row.innerHTML = `
        <div class="material-row-main">
            <div class="select-wrap">
                <select class="material-select">${_opcoesMaterialHtml(selectVal)}</select>
                <svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            ${isFirst
                ? `<button type="button" class="btn-mat-add" title="Adicionar outro material">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                   </button>`
                : `<button type="button" class="btn-mat-rem" title="Remover material">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                   </button>`
            }
        </div>
        <div class="material-outro-wrap${selectVal === 'Outro' ? '' : ' hidden'}">
            <input type="text" class="material-outro-input" placeholder="Ex: Nylon, PVA, HIPS..." value="${outroVal ? escapeHtml(outroVal) : ''}">
        </div>
    `;

    const select    = row.querySelector('.material-select');
    const outroWrap = row.querySelector('.material-outro-wrap');
    const outroInp  = row.querySelector('.material-outro-input');

    select.addEventListener('change', () => {
        if (select.value === 'Outro') {
            outroWrap.classList.remove('hidden');
            outroInp.focus();
        } else {
            outroWrap.classList.add('hidden');
            outroInp.value = '';
        }
    });

    if (isFirst) {
        row.querySelector('.btn-mat-add').addEventListener('click', () => _appendLinhaMateria(container, false, ''));
    } else {
        row.querySelector('.btn-mat-rem').addEventListener('click', () => row.remove());
    }

    container.appendChild(row);
}

function resetarMateriais() {
    const c = document.getElementById('materiais-container');
    c.innerHTML = '';
    _appendLinhaMateria(c, true, '');
}

function preencherMateriais(materiais) {
    const c = document.getElementById('materiais-container');
    c.innerHTML = '';
    const lista = (materiais && materiais.length) ? materiais : [''];
    lista.forEach((m, i) => _appendLinhaMateria(c, i === 0, m));
}

function coletarMateriais() {
    const rows = document.querySelectorAll('#materiais-container .material-row');
    const result = [];
    rows.forEach(row => {
        const sel = row.querySelector('.material-select');
        const inp = row.querySelector('.material-outro-input');
        const val = sel.value === 'Outro' ? inp.value.trim() : sel.value;
        if (val) result.push(val);
    });
    return result;
}

function getMateriais(item) {
    if (Array.isArray(item.materiais) && item.materiais.length) return item.materiais;
    if (item.material) return [item.material];
    return [];
}

// ============================================================
// MODAL — LISTA DE ORÇAMENTOS
// ============================================================
function abrirListaModal() {
    document.getElementById('lista-overlay').classList.remove('hidden');
    document.getElementById('lista-search').value = '';
    renderizarLista('');
}

function fecharListaModal() {
    document.getElementById('lista-overlay').classList.add('hidden');
}

function renderizarLista(filtro) {
    const historico = carregarHistorico();
    const termo = filtro.toLowerCase();

    const ids = Object.keys(historico)
        .filter(id => {
            if (!termo) return true;
            const b = historico[id];
            return id.toLowerCase().includes(termo) ||
                   (b.client && b.client.nome && b.client.nome.toLowerCase().includes(termo));
        })
        .sort((a, b) => {
            const dtA = historico[a].createdAt || '';
            const dtB = historico[b].createdAt || '';
            return dtB.localeCompare(dtA);
        });

    document.getElementById('lista-badge').textContent = Object.keys(historico).length;

    const body = document.getElementById('lista-body');

    if (ids.length === 0) {
        body.innerHTML = `<p class="lista-empty">${termo ? 'Nenhum resultado para "' + escapeHtml(filtro) + '".' : 'Nenhum orçamento salvo ainda.'}</p>`;
        return;
    }

    body.innerHTML = ids.map(id => {
        const b       = historico[id];
        const subtotal = (b.items || []).reduce((s, i) => s + i.preco, 0);
        const total    = subtotal - calcularDescontoEm(b, subtotal);
        const isAtivo  = b.budgetId === state.budgetId;
        const dtStr    = b.createdAt
            ? new Date(b.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—';
        const nItens   = (b.items || []).length;

        return `
        <div class="lista-item${isAtivo ? ' lista-item-ativo' : ''}">
            <div class="lista-item-main">
                <div class="lista-item-code">
                    ${escapeHtml(b.budgetId)}
                    ${isAtivo ? '<span class="lista-tag-ativo">atual</span>' : ''}
                </div>
                <div class="lista-item-info">
                    <span class="lista-item-cliente">${b.client && b.client.nome ? escapeHtml(b.client.nome) : '—'}</span>
                    <span class="lista-item-meta">${nItens} iten${nItens !== 1 ? 's' : ''} · ${dtStr}</span>
                </div>
                <div class="lista-item-total">${formatarPreco(total)}</div>
            </div>
            <div class="lista-item-actions">
                <button class="lista-action-btn lista-btn-pdf" onclick="gerarPDF(carregarHistorico()['${escapeHtml(b.budgetId)}'])" title="Gerar PDF">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        <line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/>
                    </svg>
                    PDF
                </button>
                ${!isAtivo ? `
                <button class="lista-action-btn lista-btn-edit" onclick="editarOrcamentoLista('${escapeHtml(b.budgetId)}')" title="Carregar para edição">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Editar
                </button>` : ''}
                ${!isAtivo ? `
                <button class="lista-action-btn lista-btn-del" onclick="confirmarExcluirHistorico('${escapeHtml(b.budgetId)}')" title="Excluir">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                    Excluir
                </button>` : ''}
            </div>
        </div>`;
    }).join('');
}

function calcularDescontoEm(budget, subtotal) {
    if (!budget.desconto || !budget.desconto.ativo || budget.desconto.valor <= 0) return 0;
    if (budget.desconto.tipo === 'porcentagem') return subtotal * (budget.desconto.valor / 100);
    return Math.min(budget.desconto.valor, subtotal);
}

function editarOrcamentoLista(budgetId) {
    const historico = carregarHistorico();
    const budget = historico[budgetId];
    if (!budget) return;
    state = budget;
    if (!state.desconto) state.desconto = { ativo: true, tipo: 'porcentagem', valor: 0 };
    salvarEstado();
    resetarFormulario();
    renderizar();
    fecharListaModal();
    mostrarToast('Orçamento ' + budgetId + ' carregado para edição.', 'success');
}

function confirmarExcluirHistorico(budgetId) {
    if (budgetId === state.budgetId) {
        mostrarToast('Não é possível excluir o orçamento atual.', 'error');
        return;
    }
    mostrarModal(
        '🗑️',
        'Excluir Orçamento',
        'Remover o orçamento ' + budgetId + ' permanentemente?',
        () => {
            removerDoHistorico(budgetId);
            const filtro = document.getElementById('lista-search') ? document.getElementById('lista-search').value : '';
            renderizarLista(filtro);
            mostrarToast('Orçamento excluído.', 'info');
        }
    );
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function formatarPreco(valor) {
    return valor.toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
}

function parsearPreco(str) {
    // Remove R$, espaços, pontos de milhar; substitui vírgula por ponto
    const limpo = str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) || n < 0 ? 0 : n;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizarNomeArquivo(nome) {
    return nome.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '_').trim() || 'cliente';
}

function gerarIdItem() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ============================================================
// TOAST
// ============================================================
let _toastTimer = null;

function mostrarToast(msg, tipo = 'info') {
    const el = document.getElementById('toast');
    clearTimeout(_toastTimer);
    el.className = `toast toast-${tipo} show`;

    const icones = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    el.innerHTML = `<span>${icones[tipo] || ''}</span> ${msg}`;

    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ============================================================
// MODAL DE CONFIRMAÇÃO
// ============================================================
let _modalCallback = null;

function mostrarModal(icone, titulo, mensagem, onConfirmar) {
    document.getElementById('modal-icon').textContent    = icone;
    document.getElementById('modal-title').textContent   = titulo;
    document.getElementById('modal-message').textContent = mensagem;
    document.getElementById('modal-overlay').classList.remove('hidden');
    _modalCallback = onConfirmar;

    document.getElementById('modal-confirm').onclick = () => {
        const cb = _modalCallback;  // salva antes de fecharModal zerar a ref
        fecharModal();
        if (cb) cb();
    };
}

function fecharModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    _modalCallback = null;
}
