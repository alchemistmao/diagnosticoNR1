# Diagnóstico Psicossocial NR-1 | Cuidar+

Sistema de diagnóstico psicossocial para conformidade com a NR-1, desenvolvido para a Cuidar+.

## Stack Técnica

- **Frontend**: React 18 + Vite + Framer Motion + Recharts
- **Backend**: Node.js + Express
- **Banco de dados**: PostgreSQL (dados persistentes!)
- **Autenticação**: JWT + bcrypt
- **Email**: Resend

## Deploy no Railway

### 1. Criar PostgreSQL no Railway

1. No Railway, clique em **New** → **Database** → **Add PostgreSQL**
2. O Railway criará automaticamente a variável `DATABASE_URL`

### 2. Configurar Variáveis de Ambiente

No painel do Railway, adicione estas variáveis:

| Variável | Valor |
|----------|-------|
| `JWT_SECRET` | Uma string aleatória longa |
| `RESEND_API_KEY` | Sua chave da API do Resend |
| `APP_URL` | URL do seu app (ex: https://seu-app.up.railway.app) |

### 3. Deploy

```bash
git push origin main
```

## Usuários Padrão

| Perfil | Email | Senha |
|--------|-------|-------|
| Admin | admin@cuidarmais.com.br | cuidarmais |
| RH | rh@cuidarmais.com.br | cuidarmais |

## Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Criar arquivo .env com DATABASE_URL local
cp .env.example .env

# Rodar em desenvolvimento
npm run dev
```

## Estrutura do Projeto

```
├── server/
│   ├── index.js          # Express server
│   ├── database.js       # PostgreSQL connection
│   ├── auth.js           # JWT middleware
│   ├── email.js          # Resend integration
│   └── routes/
│       ├── auth.js       # Login, password reset
│       ├── users.js      # CRUD users
│       ├── departments.js # CRUD departments
│       └── responses.js  # Survey responses + stats
├── src/
│   ├── App.jsx           # React app
│   ├── api.js            # API client
│   └── index.css         # Styles
└── public/
    └── logo.png          # Cuidar+ logo
```

## Cuidar+ | Desenvolvimento Humano

Sustentando o comportamento. Transformando a liderança.
