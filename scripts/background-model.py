# Fetches the models used by Remove Background and stores them under public/bg/, split into parts
# small enough for static hosts (Cloudflare Pages serves files up to 25 MiB). The page joins the
# parts on first use and keeps the model in the browser's cache, so it downloads once.
#
# BiRefNet-lite is re-saved with its big weights stored as 16-bit floats and cast back to 32-bit
# when the model loads: the download is half the size, and it still runs on CPUs (WebAssembly),
# which can't compute in 16-bit. The answers differ from the 32-bit model only in the 4th decimal.
#
# Run: pip install onnx numpy && python3 scripts/background-model.py [model name ...]
#      (only needed when changing a model or its revision)
import hashlib
import json
import pathlib
import shutil
import urllib.request

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

OUT = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'bg'
PART = 20 * 1024 * 1024
MODELS = [
    # BiRefNet-lite (MIT, ZhengPeng7/BiRefNet) exported at 512x512 so it fits in browser memory.
    ('birefnet-lite', 'studioludens/birefnet-lite-512', '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7', 'onnx/model.onnx', 'MIT', True),
    # The same BiRefNet-lite (MIT) exported at 1024x1024 by onnx-community: sharper hair and fur,
    # four times the work, so it is only offered on devices with a graphics chip (WebGPU).
    ('birefnet-lite-1024', 'onnx-community/BiRefNet_lite-ONNX', 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1', 'onnx/model.onnx', 'MIT', True),
    # U^2-Net small (Apache-2.0, xuebinqin/U-2-Net): the light fallback for phones with little memory.
    ('u2netp', 'BritishWerewolf/U-2-Netp', '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8', 'onnx/model.onnx', 'Apache-2.0', False),
]


def half_storage(model: onnx.ModelProto) -> onnx.ModelProto:
    """Stores large float weights as float16, each followed by a Cast back to float32."""
    graph = model.graph
    inits, casts = [], []
    for init in graph.initializer:
        if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 1024:
            half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + '__f16')
            inits.append(half)
            casts.append(helper.make_node('Cast', [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
        else:
            inits.append(init)
    del graph.initializer[:]
    graph.initializer.extend(inits)
    nodes = list(graph.node)
    del graph.node[:]
    graph.node.extend(casts + nodes)
    return model


import sys

ONLY = set(sys.argv[1:])  # optional: model names to (re)build, e.g. birefnet-lite-1024
for name, repo, revision, path, license_id, shrink in MODELS:
    if ONLY and name not in ONLY:
        continue
    folder = OUT / name
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    with urllib.request.urlopen(f'https://huggingface.co/{repo}/resolve/{revision}/{path}') as response:
        data = response.read()
    if shrink:
        data = half_storage(onnx.load_from_string(data)).SerializeToString()
    parts = []
    for at in range(0, len(data), PART):
        part = f'model.onnx.part{len(parts)}' if len(data) > PART else 'model.onnx'
        (folder / part).write_bytes(data[at:at + PART])
        parts.append(part)
    manifest = {
        'source': f'https://huggingface.co/{repo}/tree/{revision}',
        'license': license_id,
        'files': [{'path': 'model.onnx', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'parts': parts}],
    }
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{name}: {len(data) / 1e6:.1f} MB in {len(parts)} part(s)')
