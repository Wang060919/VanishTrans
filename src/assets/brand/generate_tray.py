from PIL import Image, ImageDraw
from pathlib import Path

out = Path('src-tauri/icons/tray-icon.png')
out.parent.mkdir(parents=True, exist_ok=True)
scale = 4
image = Image.new('RGBA', (32 * scale, 32 * scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
points = [(6*scale, 7*scale), (14*scale, 25*scale), (19*scale, 16*scale)]
for width, color in [(6*scale, '#11151B'), (3*scale, '#F4F5F7')]:
    draw.line(points, fill=color, width=width, joint='curve')
    for x,y in points:
        r=width//2
        draw.ellipse((x-r,y-r,x+r,y+r), fill=color)
right = [(20*scale, 14*scale), (26*scale, 7*scale)]
for width, color in [(6*scale, '#11151B'), (3*scale, '#F4F5F7')]:
    draw.line(right, fill=color, width=width)
    for x,y in right:
        r=width//2
        draw.ellipse((x-r,y-r,x+r,y+r), fill=color)
draw.ellipse((18*scale, 13*scale, 22*scale, 17*scale), fill='#6F86FF')
image.resize((32,32), Image.Resampling.LANCZOS).save(out)
