from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'extension'
version = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))['version']
output = root / 'dist' / f'WordLens-{version}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w') as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            archive.write(file, 'wordlens/' + file.relative_to(source).as_posix(),
                          compress_type=zipfile.ZIP_STORED if file.suffix == '.gz' else zipfile.ZIP_DEFLATED,
                          compresslevel=9)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
print(output)
