from .app import MODEL_DIR
from .transcriber import LocalTranscriber


if __name__ == "__main__":
    LocalTranscriber(MODEL_DIR).warmup()
    print("Modelo Whisper pronto")
