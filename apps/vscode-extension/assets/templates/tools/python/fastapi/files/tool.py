from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

# No launch on import. Manual local example: uvicorn tool:app --host 127.0.0.1
