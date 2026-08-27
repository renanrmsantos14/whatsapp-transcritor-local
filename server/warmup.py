from .app import app


if __name__ == "__main__":
    app.state.transcriber.warmup()
    print("Modelo Whisper pronto")

