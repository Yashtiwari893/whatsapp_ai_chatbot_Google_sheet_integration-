# Local Whisper Setup for Production

## Prerequisites
Ensure your deployment environment has the following installed:

### 1. Python 3.8+
```bash
python --version
```
git
### 2. FFmpeg (Now bundled with ffmpeg-static - no system installation needed)
✅ **Automatically handled** by the `ffmpeg-static` package

### 3. OpenAI Whisper (Python package)
```bash
pip install openai-whisper
```

### 4. Download Whisper Models (Optional - improves performance)
```bash
# Download base model (recommended for production)
whisper --model base
```

## Environment Setup

### For Docker Deployment:
Add to your Dockerfile:
```dockerfile
# Install Python and pip
RUN apt-get update && apt-get install -y python3 python3-pip

# Install Whisper
RUN pip3 install openai-whisper

# Download model (optional)
RUN python3 -c "import whisper; whisper.load_model('base')"
```

### For VPS/Cloud Deployment:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3 python3-pip

# Install Whisper
pip3 install openai-whisper

# Download model
whisper --model base
```

## Configuration
- The system automatically detects Hindi/Hinglish/English
- Uses `base` model for optimal speed/accuracy balance
- Audio is converted to 16kHz WAV for Whisper compatibility
- Temporary files are automatically cleaned up

## Troubleshooting
- If Whisper fails, it falls back to OpenAI API
- Check logs for FFmpeg/Whisper installation issues
- Ensure sufficient disk space for temp files
- Test with: `whisper --model base --language hi "test_audio.wav"`

## Error Messages
- `"Cannot find ffmpeg"` → FFmpeg not available (should be fixed with ffmpeg-static)
- `"whisper: command not found"` → Python Whisper not installed
- `"No module named 'whisper'"` → Python package not installed

## For Serverless Platforms (Vercel/Netlify):
❌ **Not recommended** - Local Whisper requires persistent file system access and Python runtime. Use API fallbacks only.