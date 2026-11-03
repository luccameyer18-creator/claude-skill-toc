from pathlib import Path
import sys
out = Path(sys.argv[1])
(out / 'estrutura-suja.md').write_text("""# Guia

### Passo pulado

Veja [o anexo](anexo-que-nao-existe.md) e [clique aqui](#) para mais.

| Item | Valor |
|------|-------|
| A | 1 | extra |

```python
print("bloco de código que nunca fecha")
""", encoding='utf-8')
(out / 'limpo2.md').write_text("""# Guia

## Passos

Primeiro mapeamos o processo. Depois montamos a prévia e combinamos o valor.

- Cadastro unificado
- Fila de aprovação
- Relatório semanal
""", encoding='utf-8')
# csv em Windows-1252, com linha de tamanho errado e decimal misto
(out / 'sujo.csv').write_bytes('Nome;Valor;Valor\nJosé;1,5;2\nMaria;2.5;3\nJoão;3,5\n'.encode('cp1252'))
print('ok')
