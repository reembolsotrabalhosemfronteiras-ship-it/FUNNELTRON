# Prompt para Execução e Teste Local do FUNNELTRON

## Contexto
Você está recebendo o projeto FUNNELTRON para testar localmente na máquina Windows do usuário. O objetivo é validar se a aplicação sobe corretamente (sem tela branca) antes de qualquer push para o Git ou deploy. Esta versão local difere da que está no GitHub/Railway e contém edições recentes que precisam ser validadas.

## Stack Técnica
- **Backend:** Python (FastAPI + Uvicorn) na porta 8000
- **Frontend:** React + Vite + TypeScript + Tailwind na porta 5173
- **Banco/Supabase:** `https://zzqzzmfncszoxefnzfus.supabase.co` (já configurado no `.env`)
- **Ambiente:** Windows 10 Pro, Python 3.14, Node v24.14.0

## Estado Atual do Ambiente
1. **Venv do Backend:** Já criado em `backend/.venv` com dependências instaladas.
2. **Dependência Crítica Adicionada:** O pacote `cachetools` foi instalado manualmente pois faltava no `requirements.txt` original (usado em `app/services/clarity.py`).
3. **Ajuste de Compatibilidade:** O `requirements.txt` teve o pin do Playwright alterado de `==1.48.0` para `>=1.48.0` para permitir instalação via wheel no Python 3.14 (evitando necessidade de Visual Studio Build Tools).
4. **Node Modules:** Já instalados em `frontend/node_modules`.

## Sua Missão Agora

### 1. Validar o Import do Backend
Execute o comando abaixo para garantir que não há mais erros de importação após a instalação do `cachetools`:
```powershell
& "F:\agentes ia\funeltron\FUNNELTRON\backend\.venv\Scripts\python.exe" -c "from app.main import app; print('IMPORT_OK')"
```
*Se falhar com outro ModuleNotFoundError, instale a dependência faltante e tente novamente.*

### 2. Subir os Servidores
Inicie backend e frontend em janelas separadas ou background:
- **Backend:** `cd "F:\agentes ia\funeltron\FUNNELTRON\backend"; .\.venv\Scripts\python.exe run_dev.py`
- **Frontend:** `cd "F:\agentes ia\funeltron\FUNNELTRON\frontend"; npm run dev`

### 3. Verificar Tela Branca
Acesse `http://localhost:5173` e confirme:
- A página carrega conteúdo visível (não fica em branco).
- Não há erros críticos no console do navegador (F12).
- O frontend consegue comunicar com o backend em `localhost:8000`.

### 4. Criar Executável (.bat) Funcional
Após confirmar que tudo roda, crie/atualize um arquivo `rodar_local.bat` na raiz do projeto que:
- Ative o venv do backend automaticamente.
- Inicie ambos os servidores.
- Aguarde o healthcheck do backend antes de abrir o navegador.
- Mantenha as janelas abertas para debug.

## Regras Importantes
- **NÃO FAÇA PUSH PARA O GIT.** Tudo é apenas teste local.
- **NÃO ALTERE A LÓGICA DO CÓDIGO** sem autorização explícita. Foque em fazer rodar.
- Se encontrar erros de CORS ou variáveis de ambiente, verifique os arquivos `.env` em ambas as pastas antes de modificar código.
- Reporte qualquer erro persistente com o log completo para decisão humana.

## Arquivos Chave para Referência
- `backend/run_dev.py` — Entry point do servidor Python
- `backend/app/main.py` — Configuração FastAPI e rotas
- `frontend/vite.config.ts` — Configuração do dev server e proxy
- `rodar.bat` — Script de inicialização existente (pode servir de base)