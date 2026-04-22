/* ============================================================
   UNI3D — SISTEMA DE ORÇAMENTOS
   app.js — lógica principal
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTES & ESTADO GLOBAL
// ============================================================
const STORAGE_KEY = 'uni3d_orcamento';

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
        items:     []
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
    const el = document.getElementById('logo-img');
    if (!el) return;
    const converter = () => {
        if (!el.naturalWidth) return;
        try {
            const c = document.createElement('canvas');
            c.width  = el.naturalWidth;
            c.height = el.naturalHeight;
            c.getContext('2d').drawImage(el, 0, 0);
            _logoDataUrl = c.toDataURL('image/png');
            _logoRatio   = el.naturalWidth / el.naturalHeight;
        } catch (_) { /* sem acesso canvas: PDF usará só texto */ }
    };
    if (el.complete && el.naturalWidth > 0) converter();
    else el.addEventListener('load', converter, { once: true });
}

// ============================================================
// PERSISTÊNCIA (localStorage)
// ============================================================
function carregarEstado() {
    try {
        const salvo = localStorage.getItem(STORAGE_KEY);
        if (salvo) state = JSON.parse(salvo);
    } catch (e) {
        console.warn('Não foi possível carregar dados salvos:', e);
    }
}

function salvarEstado() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

    // Seleção de material — exibe campo "Outro" se necessário
    document.getElementById('item-material').addEventListener('change', handleMaterialChange);

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

    // Limpar orçamento
    document.getElementById('clear-btn').addEventListener('click', () => {
        mostrarModal(
            '⚠️',
            'Limpar Orçamento',
            'Tem certeza? Todos os dados do cliente e itens serão removidos e um novo orçamento será criado.',
            limparOrcamento
        );
    });

    // Modal
    document.getElementById('modal-cancel').addEventListener('click', fecharModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) fecharModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') fecharModal();
    });
}

// ============================================================
// HANDLERS DO FORMULÁRIO
// ============================================================
function handleFormSubmit(e) {
    e.preventDefault();

    // Coleta de valores
    const produto      = document.getElementById('item-produto').value.trim();
    const matSelect    = document.getElementById('item-material').value;
    const matOutro     = document.getElementById('item-material-outro').value.trim();
    const cor          = document.getElementById('item-cor').value.trim();
    const precoRaw     = document.getElementById('item-preco').value;
    const preco        = parsearPreco(precoRaw);
    const editId       = document.getElementById('edit-id').value;

    // Material final (pode ser personalizado)
    const material = matSelect === 'Outro' ? matOutro : matSelect;

    // Validação
    let erros = [];
    if (!produto)   erros.push('Produto é obrigatório.');
    if (!matSelect) erros.push('Material é obrigatório.');
    if (matSelect === 'Outro' && !matOutro) erros.push('Especifique o material.');
    if (!cor)       erros.push('Cor é obrigatória.');
    if (preco <= 0) erros.push('Informe um preço válido.');

    if (erros.length > 0) {
        mostrarToast(erros[0], 'error');
        return;
    }

    if (editId) {
        // Atualizar item existente
        const idx = state.items.findIndex(i => i.id === editId);
        if (idx !== -1) {
            state.items[idx] = { ...state.items[idx], produto, material, cor, preco };
        }
        mostrarToast('Item atualizado com sucesso!', 'success');
    } else {
        // Novo item
        state.items.push({ id: gerarIdItem(), produto, material, cor, preco });
        mostrarToast('Item adicionado!', 'success');
    }

    salvarEstado();
    resetarFormulario();
    renderizarItens();
    atualizarResumo();
}

function handleMaterialChange(e) {
    const grupo = document.getElementById('material-outro-group');
    const input = document.getElementById('item-material-outro');
    if (e.target.value === 'Outro') {
        grupo.classList.remove('hidden');
        input.focus();
    } else {
        grupo.classList.add('hidden');
        input.value = '';
    }
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

    // Preenche material
    const materiais = ['PLA', 'ABS', 'PETG', 'TPU', 'ASA', 'Resina'];
    const select = document.getElementById('item-material');
    if (materiais.includes(item.material)) {
        select.value = item.material;
        document.getElementById('material-outro-group').classList.add('hidden');
    } else {
        select.value = 'Outro';
        document.getElementById('material-outro-group').classList.remove('hidden');
        document.getElementById('item-material-outro').value = item.material;
    }

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
    if (!window.jspdf) {
        mostrarToast('Biblioteca PDF não carregada. Verifique sua conexão.', 'error');
        return;
    }
    if (state.items.length === 0) {
        mostrarToast('Adicione pelo menos um item antes de exportar.', 'error');
        return;
    }
    if (!state.client.nome.trim()) {
        mostrarToast('Preencha o nome do cliente antes de exportar.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const mL = 18, mR = 18;
    const cW = pageW - mL - mR;

    // ── CABEÇALHO (fundo gradiente simulado) ──────────────────
    doc.setFillColor(11, 60, 93);       // azul escuro
    doc.rect(0, 0, pageW, 42, 'F');
    doc.setFillColor(47, 164, 231);     // azul claro (triângulo accent)
    doc.triangle(pageW - 60, 0, pageW, 0, pageW, 42, 'F');

    // Logo (usa base64 pré-carregado em precarregarLogo)
    if (_logoDataUrl) {
        const logoH = 18;
        const logoW = logoH * _logoRatio;
        doc.addImage(_logoDataUrl, 'PNG', mL, 12, logoW, logoH);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.text('Uni3D', mL + logoW + 5, 22);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text('Impressão 3D', mL + logoW + 5, 29);
    } else {
        _renderNomeHeader(doc, mL);
    }

    // Código e data no lado direito
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('ORÇAMENTO', pageW - mR, 14, { align: 'right' });
    doc.setFontSize(13);
    doc.text('#' + state.budgetId, pageW - mR, 22, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const dtCriacao = new Date(state.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    doc.text('Data: ' + dtCriacao, pageW - mR, 29, { align: 'right' });

    let y = 52;

    // ── DADOS DO CLIENTE ─────────────────────────────────────
    doc.setFillColor(208, 235, 250);    // azul claro light
    doc.roundedRect(mL, y, cW, state.client.whatsapp ? 26 : 18, 3, 3, 'F');
    doc.setDrawColor(47, 164, 231);     // azul claro
    doc.roundedRect(mL, y, cW, state.client.whatsapp ? 26 : 18, 3, 3, 'S');

    doc.setTextColor(11, 60, 93);       // azul escuro
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('DADOS DO CLIENTE', mL + 6, y + 6);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(state.client.nome, mL + 6, y + 13);

    if (state.client.whatsapp) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('WhatsApp: ' + state.client.whatsapp, mL + 6, y + 20);
    }

    y += (state.client.whatsapp ? 26 : 18) + 10;

    // ── TABELA DE ITENS ───────────────────────────────────────
    doc.setTextColor(11, 60, 93);       // azul escuro
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('ITENS DO ORÇAMENTO', mL, y);
    y += 4;

    const linhas = state.items.map((item, idx) => [
        (idx + 1).toString(),
        item.produto,
        item.material,
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
            fillColor: [11, 60, 93],    // azul escuro
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8.5
        },
        alternateRowStyles: { fillColor: [240, 249, 255] }, // azul claro light
        columnStyles: {
            0: { cellWidth: 9,  halign: 'center', fontStyle: 'bold' },
            2: { cellWidth: 22 },
            3: { cellWidth: 24 },
            4: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: [11, 60, 93] } // azul escuro
        }
    });

    y = doc.lastAutoTable.finalY + 6;

    // ── TOTAL ─────────────────────────────────────────────────
    const total = state.items.reduce((s, i) => s + i.preco, 0);
    const boxW = 72;
    doc.setFillColor(255, 106, 0);      // laranja
    doc.roundedRect(pageW - mR - boxW, y, boxW, 13, 2.5, 2.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('VALOR TOTAL', pageW - mR - boxW + 6, y + 8.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(formatarPreco(total), pageW - mR - 4, y + 9, { align: 'right' });

    // ── RODAPÉ (fixo no final da página) ──────────────────────
    doc.setTextColor(160, 174, 192);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Uni3D — Impressão 3D', pageW / 2, pageH - 9, { align: 'center' });
    doc.text(
        `Orçamento #${state.budgetId} · Gerado em ${new Date().toLocaleString('pt-BR')}`,
        pageW / 2, pageH - 5, { align: 'center' }
    );

    // ── VALIDADE (logo acima do rodapé, posição fixa) ─────────
    const validY = pageH - 22;
    doc.setFillColor(255, 248, 208);    // dourado claro
    doc.roundedRect(mL, validY, cW, 10, 2.5, 2.5, 'F');
    doc.setDrawColor(255, 195, 0);      // dourado
    doc.setLineWidth(0.5);
    doc.roundedRect(mL, validY, cW, 10, 2.5, 2.5, 'S');
    doc.setTextColor(122, 80, 0);       // dourado escuro
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Este orçamento é válido por 7 dias.', pageW / 2, validY + 6.8, { align: 'center' });

    // ── SALVA O PDF ───────────────────────────────────────────
    const nomeArq = sanitizarNomeArquivo(state.client.nome) + '_' + state.budgetId + '.pdf';
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
                    <span class="tag">${escapeHtml(item.material)}</span>
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

function atualizarResumo() {
    const total = state.items.reduce((s, i) => s + i.preco, 0);
    document.getElementById('summary-client').textContent = state.client.nome || '—';
    document.getElementById('summary-count').textContent  = state.items.length;
    document.getElementById('summary-total').textContent  = formatarPreco(total);
}

// ============================================================
// RESET DO FORMULÁRIO
// ============================================================
function resetarFormulario() {
    document.getElementById('item-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('material-outro-group').classList.add('hidden');
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
