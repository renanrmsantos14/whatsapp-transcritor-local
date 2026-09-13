from .app import MODEL_DIR
from .transcriber import LocalTranscriber


if __name__ == "__main__":
    transcriber = LocalTranscriber(MODEL_DIR)
    transcriber.warmup("fast")
    transcriber.warmup("balanced")
    print("Modelos Whisper prontos")
