"""Synthesize alert voice clips with Kokoro (mlx_audio).

stdin: JSON {"voice": "bf_emma", "speed": 0.9, "clips": [{"text": "...", "out": "/abs.wav"}]}
Writes one 24 kHz mono WAV per clip, one Kokoro call per clip.
"""

import json
import math
import sys

import numpy as np
import soundfile as sf
from huggingface_hub import hf_hub_download
from mlx_audio.tts.models import interpolate as interpolate_module
from mlx_audio.tts.models.kokoro import istftnet
from mlx_audio.tts.utils import load_model

REPO = "mlx-community/Kokoro-82M-bf16"

# mlx_audio derives `interpolate` sizes as ceil(width * 1/300), which overshoots on exact multiples
# (ceil(240.00000000000003) == 241) and kills Kokoro with a broadcast error. Snap before the ceil.
_interpolate = interpolate_module.interpolate


def _snapped(input, size=None, scale_factor=None, **kwargs):
    if size is None and scale_factor is not None:
        dims = input.ndim - 2
        factors = scale_factor if isinstance(scale_factor, (list, tuple)) else [scale_factor] * dims
        size = []
        for i in range(dims):
            value = input.shape[i + 2] * float(factors[i])
            nearest = round(value)
            value = float(nearest) if abs(value - nearest) < 1e-6 else value
            size.append(max(1, int(math.ceil(value))))
        scale_factor = None
    return _interpolate(input, size=size, scale_factor=scale_factor, **kwargs)


interpolate_module.interpolate = _snapped
istftnet.interpolate = _snapped

job = json.load(sys.stdin)
voice = job["voice"]
# Kokoro needs the voice as an absolute .safetensors path.
voice_path = hf_hub_download(REPO, f"voices/{voice}.safetensors")
model = load_model(REPO)
for clip in job["clips"]:
    audio = np.concatenate(
        [
            np.array(r.audio, dtype=np.float32).reshape(-1)
            for r in model.generate(
                text=clip["text"], voice=voice_path, speed=job["speed"], lang_code=voice[0]
            )
        ]
    )
    sf.write(clip["out"], audio, 24000)
