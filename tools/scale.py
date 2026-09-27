# usage: python tools/scale.py <file> <level-id> <factor>
# Multiplies every rps in that level's traffic block, rounding to 5.
import re, sys
path, lid, k = sys.argv[1], sys.argv[2], float(sys.argv[3])
s = open(path, encoding='utf8').read()
start = s.index(f"id: '{lid}'")
t0 = s.index('traffic: [', start)
t1 = s.index('chaos:', t0)
block = re.sub(r'rps: (\d+)', lambda m: f"rps: {int(round(int(m.group(1)) * k / 5) * 5)}", s[t0:t1])
open(path, 'w', encoding='utf8').write(s[:t0] + block + s[t1:])
