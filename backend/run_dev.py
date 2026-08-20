"""Launcher local: evita que backend/supabase/ (pasta de migrations do
Supabase CLI) seja importada no lugar do pacote pip `supabase` quando o
cwd é adicionado ao sys.path[0] por padrão."""
import sys
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

if BACKEND_DIR in sys.path:
    sys.path.remove(BACKEND_DIR)
sys.path.append(BACKEND_DIR)

os.chdir(BACKEND_DIR)

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
