# Mastermind Brittany HTR

This is the offline handwriting-recognition layer for the genealogy archive. It has one narrow job: turn a page image into ordered text lines with coordinates and confidence. Parish-record interpretation happens later and never overwrites the literal reading.

The engine uses Kraken in a private Python 3.13 environment. Page segmentation can start before a custom recognition model exists. Corrected line images become the gold dataset for `Brittany Parish HTR v1`; uncorrected GPT-era readings remain hints only.

## Local commands

```powershell
uv venv --python 3.13 services/brittany-htr/.venv
uv pip install --python services/brittany-htr/.venv/Scripts/python.exe "kraken>=7,<8"
services/brittany-htr/.venv/Scripts/python.exe services/brittany-htr/brittany_htr.py health
```

Segmenting a stored page requires no recognition model:

```powershell
services/brittany-htr/.venv/Scripts/python.exe services/brittany-htr/brittany_htr.py page --image PAGE.jpg --output PAGE.xml
```

When a base or trained model is available, add `--model MODEL.safetensors`. The output is PageXML plus a JSON summary containing ordered line boxes, literal text, and confidence.

Gold-line manifests use one JSON object per line:

```json
{"id": 41, "pageId": 5, "image": "C:/archive/page-5.jpg", "bbox": {"x": 120, "y": 310, "width": 980, "height": 90}, "text": "Jehan fils de Mathurin ..."}
```

The `dataset` command makes deterministic train/validation/test splits by page so lines from the same page cannot leak across evaluation. `train` starts a PP-OCRv6-small model and refuses to run until there are at least 20 training and 5 validation lines.
