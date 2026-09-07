import os
os.chdir(r"F:\agentes ia\funeltron\FUNNELTRON\backend")
from dotenv import load_dotenv
load_dotenv()
import uvicorn

if __name__ == '__main__':
    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=True)
