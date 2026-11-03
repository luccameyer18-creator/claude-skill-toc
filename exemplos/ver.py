import json, sys
d = json.load(open(sys.argv[1] + '/doc.json', encoding='utf-8'))
print('tipo', d['tipo'], '| info', {k: v for k, v in d['info'].items() if k != 'titulos'}, '| blocos', len(d['blocos']), '| folhas', d['folhas'])
for a in d['avisos']: print('AVISO', a)
ordem = {'bloqueia': 0, 'corrigir': 1, 'nota': 2}
for a in sorted(d['achados'], key=lambda a: (ordem[a['gravidade']], a['regra'])):
    print(f"[{a['gravidade']}] {a['regra']} · {a['onde']}: {a['detalhe'][:150]}")
