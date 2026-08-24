from pathlib import Path

p = Path("scripts/patch-rumble-curated-v1101.py")
s = p.read_text()
old_call = '''replace_once(
''' + "'''        const repeatStat = repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;'''" + ''',
''' + "'''        const repeatStat = !incomingBlocked && repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;'''" + ''',
"live repeat firewall"
)'''
new_call = '''old_repeat = '        const repeatStat = repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;'
new_repeat = '        const repeatStat = !incomingBlocked && repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;'
if text.count(old_repeat) != 2:
    raise SystemExit(f"expected two repeatStat anchors, got {text.count(old_repeat)}")
first_repeat = text.find(old_repeat)
second_repeat = text.find(old_repeat, first_repeat + len(old_repeat))
text = text[:second_repeat] + new_repeat + text[second_repeat + len(old_repeat):]'''
if s.count(old_call) != 1:
    raise SystemExit(f"expected one helper block to replace, got {s.count(old_call)}")
p.write_text(s.replace(old_call, new_call, 1))
