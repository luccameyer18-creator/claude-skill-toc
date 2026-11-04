"""Conferência de vídeo do toc: plano (composição HyperFrames), medidas do arquivo final e a partitura.

Uso: python -I video.py <contrato.json> <raiz> <saida>
Grava <saida>/video.json com achados, itens, folhas, avisos, blocos de texto e medidas.

O plano (index.html) é conferido sem render: quando cada clipe entra, onde caem as batidas, quanto a voz fica
acima da música. O vídeo final, se existir, é medido de verdade: volume, pico, tela preta, imagem parada,
silêncio, cortes, o instante em que a imagem muda perto de cada momento pedido e se a fala ainda se entende na mixagem.
"""
import json, math, os, re, subprocess, sys, unicodedata
from html.parser import HTMLParser

import numpy as np

AVISOS = []
ACHADOS = []
FPS_PADRAO = 30.0


def achar(regra, gravidade, onde, detalhe):
    ACHADOS.append({'regra': regra, 'gravidade': gravidade, 'onde': onde, 'detalhe': detalhe, 'porDetalhe': True})


def ts(t):
    """1:05.32 para leitura humana."""
    if t is None:
        return '?'
    m, s = divmod(max(0.0, float(t)), 60)
    return f'{int(m)}:{s:05.2f}'


# ---------------------------------------------------------------- plano (index.html)

VAZIOS = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class Plano(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.clipes, self.audios, self.pilha, self.raiz = [], [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        reg = None
        if self.raiz is None and 'data-composition-id' in a and a.get('data-duration'):
            self.raiz = float(a['data-duration'])
        if 'data-start' in a:
            try:
                ini = float(a['data-start'])
                dur = float(a.get('data-duration') or 0)
            except ValueError:  # início relativo a outro clipe: fora do alcance da v1
                ini = None
            if ini is not None:
                reg = {'id': a.get('id', ''), 'classe': a.get('class', ''), 'tag': tag, 'inicio': ini, 'dur': dur, 'texto': ''}
                if tag in ('audio', 'video') and a.get('src'):
                    reg.update(src=a['src'], volume=float(a.get('data-volume') or 1), comSom=tag == 'audio' or a.get('data-has-audio') == 'true')
                    self.audios.append(reg)
                else:
                    self.clipes.append(reg)
        if tag not in VAZIOS:
            self.pilha.append((tag, reg))

    def handle_endtag(self, tag):
        while self.pilha:
            t, _ = self.pilha.pop()
            if t == tag:
                break

    def handle_data(self, d):
        if not d.strip():
            return
        if self.pilha and self.pilha[-1][0] in ('script', 'style'):
            return
        for _, reg in self.pilha:
            if reg is not None:
                reg['texto'] += ' ' + d  # palavras em spans vizinhos não podem grudar


def ler_plano(arq):
    p = Plano()
    with open(arq, encoding='utf-8') as f:
        p.feed(f.read())
    for r in p.clipes + p.audios:
        r['texto'] = re.sub(r'\s+', ' ', r['texto']).strip()
    return p


def casa(reg, padrao):
    """O padrão vale para o id ou para uma das classes (assim ^head0$ acha o id mesmo com class="clip h3d")."""
    return any(re.search(padrao, x, re.I) for x in [reg['id']] + reg['classe'].split())


# ---------------------------------------------------------------- áudio

def carregar(arq, sr, inicio=0.0, dur=None):
    import librosa
    y, _ = librosa.load(arq, sr=sr, mono=True, offset=inicio, duration=dur)
    return y.astype(np.float32)


def audio_do_video(arq, sr=16000):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', arq, '-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True)
    if r.returncode or not r.stdout:
        return None
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def db(x):
    return 20 * math.log10(max(float(x), 1e-9))


def rms_quadros(y, sr, hop=0.02):
    n = int(sr * hop)
    k = len(y) // n
    if k == 0:
        return np.zeros(0)
    return np.sqrt(np.mean(y[:k * n].reshape(k, n) ** 2, axis=1) + 1e-12)


def grade_de_batidas(musica, c, duracao):
    """Batidas no tempo do vídeo. Com bpm no contrato, grade perfeita alinhada às batidas detectadas."""
    import librosa
    sr = 22050
    y = carregar(musica['arq'], sr, musica.get('corte', 0.0), musica.get('dur') or None)
    m = c.get('musica') or {}
    bpm = m.get('bpm')
    tempo, quadros = librosa.beat.beat_track(y=y, sr=sr, start_bpm=bpm or 120, tightness=400 if bpm else 100, units='frames')
    det = librosa.frames_to_time(quadros, sr=sr) + musica['inicio']
    bpm_usado = float(bpm or np.atleast_1d(tempo)[0])
    if bpm:
        p = 60.0 / bpm
        if m.get('batidaEm') is not None:  # tempo da música em que cai uma batida conhecida (o mais confiável)
            fase = (float(m['batidaEm']) - float(m.get('inicio', 0)) ) % p
        else:
            # fase que põe mais ataque (bumbo) em cima da grade; beat_track às vezes trava no contratempo
            hop = 256
            env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, fmax=300, n_mels=32)
            te = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=hop) + musica['inicio']
            cand = np.arange(0, p, 0.004)
            nota = [np.sum(np.interp(np.arange(f0, te[-1], p), te, env)) for f0 in cand]
            fase = float(cand[int(np.argmax(nota))])
        grade = np.arange(fase - p * math.floor(fase / p), duracao + p, p)
    else:
        grade = det
    env = rms_quadros(y, sr, 0.05)
    return {'batidas': [float(x) for x in grade if 0 <= x <= duracao + 0.01], 'bpm': bpm_usado,
            'envoltoria': [float(v) for v in env], 'envPasso': 0.05, 'envInicio': musica['inicio']}


def grade_sub(batidas, sub):
    """sub=0.5 põe meias batidas; sub=2 fica com uma a cada duas."""
    b = np.array(batidas)
    if len(b) < 2 or sub == 1:
        return b
    if sub < 1:
        k = int(round(1 / sub))
        pts = [b[i] + (b[i + 1] - b[i]) * j / k for i in range(len(b) - 1) for j in range(k)] + [b[-1]]
        return np.array(pts)
    return b[::int(round(sub))]


def mais_perto(t, grade):
    if not len(grade):
        return None, None
    i = int(np.argmin(np.abs(grade - t)))
    return float(grade[i]), (t - float(grade[i])) * 1000


# ---------------------------------------------------------------- vídeo final

def sonda(arq):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration:format=duration',
                        '-of', 'json', arq], capture_output=True, text=True)
    j = json.loads(r.stdout or '{}')
    v = next((s for s in j.get('streams', []) if s.get('codec_type') == 'video'), None)
    a = next((s for s in j.get('streams', []) if s.get('codec_type') == 'audio'), None)
    fps = FPS_PADRAO
    if v and v.get('r_frame_rate', '0/0') != '0/0':
        n, d = v['r_frame_rate'].split('/')
        fps = float(n) / float(d)
    return {'duracao': float(j.get('format', {}).get('duration') or 0), 'largura': v and v.get('width'), 'altura': v and v.get('height'),
            'fps': fps, 'temAudio': a is not None, 'durVideo': float(v.get('duration') or 0) if v else 0,
            'durAudio': float(a.get('duration') or 0) if a else 0}


def quadros_cinza(arq, lado=96):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', arq, '-vf', f'scale={lado}:{lado},format=gray', '-f', 'rawvideo', '-'], capture_output=True)
    if r.returncode or not r.stdout:
        return None
    return np.frombuffer(r.stdout, dtype=np.uint8).reshape(-1, lado, lado)


def medir_som(arq):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', arq, '-vn', '-af', 'silencedetect=n=-45dB:d=1.2,ebur128=peak=true',
                        '-f', 'null', '-'], capture_output=True, text=True, errors='replace')
    s = r.stderr
    resumo = s[s.rfind('Summary:'):] if 'Summary:' in s else ''
    lufs = re.search(r'I:\s*(-?[\d.]+) LUFS', resumo)
    pico = re.search(r'Peak:\s*(-?[\d.]+|-inf) dBFS', resumo)
    silencios, ini = [], None
    for m in re.finditer(r'silence_(start|end): (-?[\d.]+)', s):
        if m.group(1) == 'start':
            ini = float(m.group(2))
        elif ini is not None:
            silencios.append((ini, float(m.group(2))))
            ini = None
    return {'lufs': float(lufs.group(1)) if lufs else None,
            'pico': (float(pico.group(1)) if pico and pico.group(1) != '-inf' else None), 'silencios': silencios}


def corridas(mask, fps, minimo):
    out, ini = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and ini is None:
            ini = i
        elif not v and ini is not None:
            if (i - ini) / fps >= minimo:
                out.append((ini / fps, i / fps))
            ini = None
    return out


# ---------------------------------------------------------------- fala (Whisper local)

_modelo = None


def whisper():
    global _modelo
    if _modelo is None:
        from faster_whisper import WhisperModel
        nome = os.environ.get('TOC_WHISPER', 'small')
        base = os.path.expanduser(f'~/.cache/huggingface/hub/models--Systran--faster-whisper-{nome}/snapshots')
        alvo = os.path.join(base, sorted(os.listdir(base))[-1]) if os.path.isdir(base) else nome
        _modelo = WhisperModel(alvo, device='cpu', compute_type='int8')
    return _modelo


def palavras(y, idioma, deslocamento=0.0):
    segs, _ = whisper().transcribe(y, language=idioma, word_timestamps=True, beam_size=1, vad_filter=False, condition_on_previous_text=False)
    out = []
    for sg in segs:
        for w in sg.words or []:
            n = norm(w.word)
            if n:
                out.append({'p': n, 'bruto': w.word.strip(), 'ini': w.start + deslocamento, 'fim': w.end + deslocamento})
    return out


def emendar_e_ouvir(y, janelas, sr, idioma, folga=0.5):
    """Transcreve só os trechos pedidos numa chamada: emenda com silêncio e devolve as palavras de cada trecho no tempo do vídeo."""
    partes, mapa, pos = [], [], 0.0
    for a0, a1 in janelas:
        seg = y[int(a0 * sr):int(a1 * sr)]
        partes += [seg, np.zeros(int(folga * sr), dtype=np.float32)]
        mapa.append((pos, pos + len(seg) / sr, a0))
        pos += len(seg) / sr + folga
    if not partes:
        return []
    ws = palavras(np.concatenate(partes).astype(np.float32), idioma)
    out = [[] for _ in janelas]
    for w in ws:
        meio = (w['ini'] + w['fim']) / 2
        for k, (p0, p1, a0) in enumerate(mapa):
            if p0 - 0.1 <= meio <= p1 + 0.1:
                out[k].append({**w, 'ini': w['ini'] - p0 + a0, 'fim': w['fim'] - p0 + a0})
                break
    return out


def banda(y, sr, lo=300, hi=4000):
    """Só a faixa da fala: o grave da música pesa no RMS mas quase não cobre a voz."""
    if not len(y):
        return y
    f = np.fft.rfftfreq(len(y), 1 / sr)
    Y = np.fft.rfft(y)
    Y[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(Y, n=len(y)).astype(np.float32)


_t0 = [None]


def marca(rotulo):
    import time
    agora = time.time()
    if os.environ.get('TOC_DEBUG') and _t0[0] is not None:
        sys.stderr.write(f'[video {agora - _t0[0]:.1f}s] {rotulo}\n')
    _t0[0] = agora


def norm(s):
    s = unicodedata.normalize('NFKD', s.lower())
    return re.sub(r'[^a-z0-9]', '', ''.join(ch for ch in s if not unicodedata.combining(ch)))


def recall(esperadas, ouvidas):
    pool = {}
    for w in ouvidas:
        pool[w['p']] = pool.get(w['p'], 0) + 1
    ok = 0
    for w in esperadas:
        if pool.get(w['p'], 0) > 0:
            pool[w['p']] -= 1
            ok += 1
            w['ouvida'] = True
        else:
            w['ouvida'] = False
    return ok / len(esperadas) if esperadas else 1.0


# ---------------------------------------------------------------- folhas

def fonte(t):
    from PIL import ImageFont
    for f in ('arial.ttf', 'DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(f, t)
        except OSError:
            pass
    return ImageFont.load_default()


VERDE, VERMELHO, CINZA, AZUL, PRETO, LARANJA = (22, 140, 70), (210, 40, 40), (150, 150, 150), (40, 90, 220), (25, 25, 25), (230, 130, 20)


def partitura(saida, dur, m):
    """Uma imagem por trecho de 15 s, com uma faixa para cada coisa medida. Vermelho é o que está fora."""
    from PIL import Image, ImageDraw
    seg, pxs, esq = 15.0, 150, 120
    faixas = [('música', 70), ('plano', 46), ('cortes', 30), ('momentos', 44), ('voz', 40), ('fala', 34), ('legendas', 40)]
    alt = 30 + sum(h for _, h in faixas) + 10
    folhas = []
    f12, f14 = fonte(12), fonte(14)
    n = max(1, math.ceil(dur / seg))
    for k in range(n):
        t0, t1 = k * seg, min(dur, (k + 1) * seg)
        im = Image.new('RGB', (esq + int(seg * pxs) + 20, alt), 'white')
        d = ImageDraw.Draw(im)
        X = lambda t: esq + (t - t0) * pxs
        d.text((8, 8), f'partitura {ts(t0)} – {ts(t1)}', fill=PRETO, font=f14)
        for s in range(int(t0) + 1, int(t1) + 1):
            d.line([(X(s), 26), (X(s), alt - 8)], fill=(235, 235, 235))
            d.text((X(s) + 2, 12), f'{s}s', fill=CINZA, font=f12)
        y = 30
        lanes = {}
        for nome, h in faixas:
            lanes[nome] = (y, y + h)
            d.line([(esq, y), (im.width, y)], fill=(220, 220, 220))
            d.text((8, y + h / 2 - 7), nome, fill=PRETO, font=f12)
            y += h
        dentro = lambda t: t0 - 0.05 <= t <= t1 + 0.05
        # música: envoltória e batidas
        a, b = lanes['música']
        g = m.get('grade')
        if g:
            env, passo, ini = g['envoltoria'], g['envPasso'], g['envInicio']
            mx = max(env) if env else 1
            for i, v in enumerate(env):
                t = ini + i * passo
                if dentro(t):
                    hh = (b - a - 8) * v / mx
                    d.line([(X(t), b - 4 - hh), (X(t), b - 4)], fill=(200, 200, 215))
            for i, t in enumerate(g['batidas']):
                if dentro(t):
                    d.line([(X(t), a + 2), (X(t), b - 2)], fill=(90, 90, 90) if i % 4 == 0 else (175, 175, 175), width=2 if i % 4 == 0 else 1)
        # plano: eventos dos itens de batida
        a, b = lanes['plano']
        for e in m.get('eventosPlano', []):
            if dentro(e['t']):
                cor = VERDE if e['ok'] else VERMELHO
                d.polygon([(X(e['t']), a + 6), (X(e['t']) - 5, a + 16), (X(e['t']) + 5, a + 16)], fill=cor)
                d.text((X(e['t']) + 4, a + 20), e['rotulo'][:14] + ('' if e['ok'] else f" {e['ms']:+.0f}ms"), fill=cor, font=f12)
        a, b = lanes['cortes']
        for e in m.get('eventosVideo', []):
            if dentro(e['t']):
                cor = VERDE if e['ok'] else VERMELHO
                d.line([(X(e['t']), a + 4), (X(e['t']), b - 4)], fill=cor, width=3)
        a, b = lanes['momentos']
        for mo in m.get('momentos', []):
            if dentro(mo['esperado']):
                xe = X(mo['esperado'])
                for yy in range(a + 2, b - 2, 6):
                    d.line([(xe, yy), (xe, yy + 3)], fill=AZUL, width=2)
                d.text((xe + 4, a + 2), mo['id'], fill=AZUL, font=f12)
            for chave, cor in (('plano', LARANJA), ('video', None)):
                t = mo.get(chave)
                if t is not None and dentro(t):
                    c2 = cor or (VERDE if mo['ok'] else VERMELHO)
                    d.ellipse([X(t) - 5, b - 16, X(t) + 5, b - 6], fill=c2)
        a, b = lanes['voz']
        for v in m.get('vozes', []):
            x0, x1 = X(max(t0, v['inicio'])), X(min(t1, v['fim']))
            if x1 > x0 and v['fim'] > t0 and v['inicio'] < t1:
                cor = VERDE if v.get('ok', True) else VERMELHO
                d.rectangle([x0, a + 6, x1, b - 14], outline=cor, width=2)
                if v.get('relacao') is not None and v['inicio'] >= t0:
                    d.text((x0 + 3, b - 13), f"{v['id']} {v['relacao']:+.0f} dB", fill=cor, font=f12)
        a, b = lanes['fala']
        ult = -1e9
        for w in m.get('fala', []):
            if dentro(w['ini']) and X(w['ini']) > ult:
                cor = PRETO if w.get('ouvida', True) else VERMELHO
                d.text((X(w['ini']), a + 8), w['bruto'], fill=cor, font=f12)
                ult = X(w['ini']) + d.textlength(w['bruto'], font=f12) + 3
        a, b = lanes['legendas']
        for lg in m.get('legendas', []):
            if lg['fim'] > t0 and lg['inicio'] < t1:
                cor = VERDE if lg.get('ok', True) else VERMELHO
                x0, x1 = X(max(t0, lg['inicio'])), X(min(t1, lg['fim']))
                d.rectangle([x0, a + 4, x1, b - 4], outline=cor)
                d.text((x0 + 3, a + 10), lg['texto'][:max(3, int((x1 - x0) / 7))], fill=cor, font=f12)
        nome = f'partitura-{k + 1:02d}.png'
        im.save(os.path.join(saida, nome))
        folhas.append(nome)
    return folhas


def folha_quadros(saida, arq, marcas):
    """Quadros do vídeo final nos instantes que importam (momentos pedidos, eventos fora da batida)."""
    import cv2
    from PIL import Image, ImageDraw
    if not marcas:
        return []
    cap = cv2.VideoCapture(arq)
    os.makedirs(os.path.join(saida, 'quadros'), exist_ok=True)
    fotos = []
    for t, rot in marcas[:24]:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0, t) * 1000)
        ok, fr = cap.read()
        if not ok:
            continue
        nome = f'quadros/q-{t:07.3f}.jpg'.replace(':', '')
        cv2.imwrite(os.path.join(saida, nome), fr, [cv2.IMWRITE_JPEG_QUALITY, 82])
        fotos.append((nome, t, rot))
    cap.release()
    if not fotos:
        return []
    f13 = fonte(13)
    larg = 220
    ims = []
    for nome, t, rot in fotos:
        im = Image.open(os.path.join(saida, nome)).convert('RGB')
        im = im.resize((larg, int(im.height * larg / im.width)))
        ims.append((im, t, rot))
    h = ims[0][0].height + 36
    cols = min(6, len(ims))
    linhas = math.ceil(len(ims) / cols)
    folha = Image.new('RGB', (cols * (larg + 8) + 8, linhas * (h + 8) + 8), 'white')
    d = ImageDraw.Draw(folha)
    for i, (im, t, rot) in enumerate(ims):
        x, y = 8 + (i % cols) * (larg + 8), 8 + (i // cols) * (h + 8)
        folha.paste(im, (x, y))
        d.text((x, y + im.height + 3), f'{ts(t)} {rot}'[:34], fill=PRETO, font=f13)
    folha.save(os.path.join(saida, 'folha-quadros.jpg'), quality=85)
    return ['folha-quadros.jpg']


# ---------------------------------------------------------------- conferência

def principal(contrato_arq, raiz, saida):
    os.makedirs(saida, exist_ok=True)
    marca('início')
    c = json.load(open(contrato_arq, encoding='utf-8'))
    itens = {}
    res = lambda it, ok, det, conferido=True: itens.__setitem__(it['id'], {'ok': bool(ok), 'detalhe': det, 'conferido': conferido})
    idioma = ((c.get('estilo') or {}).get('idioma') or 'pt').split('-')[0]
    arq = os.path.join(raiz, c['arquivo']) if c.get('arquivo') else None
    tem_final = bool(arq and os.path.exists(arq))
    comp = os.path.join(raiz, c['composicao']) if c.get('composicao') else None
    idx = comp if comp and comp.endswith('.html') else (os.path.join(comp, 'index.html') if comp else None)
    plano = ler_plano(idx) if idx and os.path.exists(idx) else None
    if comp and not plano:
        AVISOS.append(f'composição sem index.html em {comp}: só o arquivo final foi conferido')
    base_media = os.path.dirname(idx) if plano else raiz
    info = sonda(arq) if tem_final else {}
    dur = info.get('duracao') or (plano.raiz if plano and plano.raiz else max([r['inicio'] + r['dur'] for r in (plano.clipes + plano.audios)] or [0]) if plano else 0)
    m = {'duracao': dur}
    if not tem_final:
        AVISOS.append(f'sem vídeo renderizado ({c.get("arquivo") or "arquivo não informado"}): conferi só o plano; volume, quadros, cortes e fala ficam para depois do render')

    # música e grade de batidas
    mc = c.get('musica') or {}
    musica = None
    if mc.get('arquivo'):
        musica = {'arq': os.path.join(raiz, mc['arquivo']), 'inicio': float(mc.get('em', 0)), 'corte': float(mc.get('corte', 0)), 'dur': None}
    elif plano:
        cand = [a for a in plano.audios if re.search(mc.get('seletor') or r'music|musica|trilha|bgm|song', f"{a['id']} {a['src']}", re.I)]
        if cand:
            a = cand[0]
            musica = {'arq': os.path.join(base_media, a['src']), 'inicio': a['inicio'], 'corte': 0.0, 'dur': a['dur'] or None, 'volume': a['volume'], 'id': a['id']}
    if not musica and tem_final and any(i['tipo'] in ('batida', 'momento') for i in c['itens']):
        musica = {'arq': arq, 'inicio': 0.0, 'corte': 0.0, 'dur': None}
        AVISOS.append('sem faixa de música separada: batidas tiradas do áudio final (a voz pode confundir a detecção)')
    precisa_grade = any(i['tipo'] == 'batida' for i in c['itens'])
    if musica and (precisa_grade or plano):
        try:
            m['grade'] = grade_de_batidas(musica, c, dur)
        except Exception as e:  # noqa: BLE001
            AVISOS.append(f'não consegui achar as batidas: {e}')
        marca('batidas')
    batidas = m.get('grade', {}).get('batidas', [])
    relogio = mc.get('inicio')  # tempo da música no segundo 0 do vídeo (para "musicaEm")

    # vídeo final: quadros, som, cortes
    dif, cortes, fps = None, [], info.get('fps', FPS_PADRAO)
    if tem_final:
        if not info['temAudio']:
            achar('video-sem-audio', 'bloqueia', c['arquivo'], 'o arquivo final não tem trilha de áudio')
        elif abs(info['durAudio'] - info['durVideo']) > 0.1 and info['durVideo']:
            achar('video-duracao-audio', 'corrigir', c['arquivo'], f"áudio {info['durAudio']:.2f} s e imagem {info['durVideo']:.2f} s: um acaba antes do outro")
        q = quadros_cinza(arq)
        if q is not None and len(q) > 2:
            qf = q.astype(np.float32)
            dif = np.concatenate([[0], np.mean(np.abs(np.diff(qf, axis=0)), axis=(1, 2)) / 255])
            lum = np.mean(qf, axis=(1, 2)) / 255
            for a0, a1 in corridas(lum < 0.04, fps, 0.3):
                if a0 > 0.25 and a1 < dur - 0.25:
                    achar('video-tela-preta', 'corrigir', f'{ts(a0)}–{ts(a1)}', f'tela preta por {a1 - a0:.1f} s no meio do vídeo')
            for a0, a1 in corridas(dif < 0.0015, fps, 2.0):
                if a1 < dur - 0.25:
                    achar('video-imagem-parada', 'nota', f'{ts(a0)}–{ts(a1)}', f'imagem parada por {a1 - a0:.1f} s: confira se é pausa de propósito')
            med = float(np.median(dif[1:])) if len(dif) > 1 else 0
            lim = max(0.08, 6 * med)
            cortes = [i / fps for i in range(1, len(dif) - 1) if dif[i] > lim and dif[i] >= dif[i - 1] and dif[i] >= dif[i + 1]]
            m['cortes'] = cortes
        else:
            AVISOS.append('não consegui ler os quadros do vídeo (ffmpeg)')
        marca('quadros lidos')
        if info['temAudio']:
            som = medir_som(arq)
            m['som'] = som
            marca('som medido')
            for s0, s1 in som['silencios']:
                if s0 > 0.3 and s1 < dur - 0.5:
                    achar('video-silencio', 'nota', f'{ts(s0)}–{ts(s1)}', f'{s1 - s0:.1f} s de silêncio no meio: confira se é pausa de propósito')
            if som['pico'] is not None and som['pico'] > -1.0:
                achar('video-pico', 'corrigir', c['arquivo'], f"pico real {som['pico']:.1f} dBTP acima de -1: distorce no celular → limitar em -1.5 dBTP")
            if som['lufs'] is not None and not any(i['tipo'] == 'volume' for i in c['itens']) and not -16.5 <= som['lufs'] <= -11.5:
                achar('video-volume', 'nota', c['arquivo'], f"volume {som['lufs']:.1f} LUFS; redes sociais normalizam perto de -14")

    # vozes: relação com a música (das faixas separadas, antes da mixagem) e fala reconhecível
    vozes = []
    vc = c.get('voz') or {}
    if plano:
        pad = vc.get('seletor') or r'voz|voice|narr|fala|vo-'
        for a in plano.audios:
            if a is not None and (not musica or a['id'] != musica.get('id')) and re.search(pad, f"{a['id']} {a['src']}", re.I):
                vozes.append({'id': a['id'], 'arq': os.path.join(base_media, a['src']), 'inicio': a['inicio'], 'fim': a['inicio'] + a['dur'], 'volume': a['volume']})
    sr = 16000
    for v in vozes:
        try:
            y = carregar(v['arq'], sr) * v['volume']
            v['_y'] = y[:int((v['fim'] - v['inicio']) * sr)] if v['fim'] > v['inicio'] else y
            rv = rms_quadros(v['_y'], sr)
            at = np.nonzero(rv > rv.max() * 10 ** (-35 / 20))[0] if len(rv) and rv.max() > 0 else []
            v['falaIni'] = v['inicio'] + (at[0] * 0.02 if len(at) else 0)
            v['falaFim'] = v['inicio'] + ((at[-1] + 1) * 0.02 if len(at) else len(v['_y']) / sr)
        except Exception as e:  # noqa: BLE001
            v['erro'] = str(e).split(':')[0]
    falhas = [v['id'] for v in vozes if 'erro' in v]
    if falhas:
        AVISOS.append(f'não consegui abrir {len(falhas)} voz(es) ({", ".join(falhas[:4])}{"…" if len(falhas) > 4 else ""}): o caminho do src existe a partir da composição?')
    vozes = sorted([v for v in vozes if '_y' in v], key=lambda v: v['inicio'])
    marca('vozes abertas')
    # Sobreposição pela fala de verdade, não pela duração do clipe (que leva o silêncio do fim junto).
    for v1, v2 in zip(vozes, vozes[1:]):
        if v1['falaFim'] - v2['falaIni'] > 0.15:
            achar('voz-sobreposta', 'corrigir', f"{v1['id']} × {v2['id']}", f"{v1['id']} ainda fala até {ts(v1['falaFim'])} e {v2['id']} começa em {ts(v2['falaIni'])}: duas falas ao mesmo tempo")
    if vozes and musica and musica['arq'] != arq:
        try:
            mus = banda(carregar(musica['arq'], sr, musica.get('corte', 0), musica.get('dur')) * musica.get('volume', 1), sr)
            for v in vozes:
                rv = rms_quadros(banda(v['_y'], sr), sr)
                ativo = rv > (rv.max() * 10 ** (-30 / 20)) if len(rv) else rv
                i0 = int((v['inicio'] - musica['inicio']) * sr)
                trecho = mus[max(0, i0):max(0, i0) + len(v['_y'])]
                rm = rms_quadros(np.pad(trecho, (0, max(0, len(v['_y']) - len(trecho)))), sr)
                k = min(len(rv), len(rm))
                if k and ativo[:k].any():
                    v['relacao'] = db(np.sqrt(np.mean(rv[:k][ativo[:k]] ** 2))) - db(np.sqrt(np.mean(rm[:k][ativo[:k]] ** 2)))
        except Exception as e:  # noqa: BLE001
            AVISOS.append(f'não consegui medir voz contra música: {e}')
        marca('voz × música')

    # Fala: o Whisper ouve as vozes limpas e a mixagem final nos mesmos trechos (uma chamada para cada,
    # trechos emendados com silêncio). Palavra que some na mixagem é palavra que o público perde.
    quer_fala = any(i['tipo'] in ('fala', 'legenda') for i in c['itens'])
    falas_limpas = []
    if vozes and quer_fala:
        try:
            jan = [(max(0.0, v['falaIni'] - 0.25), v['falaFim'] + 0.35) for v in vozes]
            limpa = np.zeros(int((dur + 1) * sr), dtype=np.float32)
            for v in vozes:
                i0 = int(v['inicio'] * sr)
                seg = v['_y'][:max(0, len(limpa) - i0)]
                limpa[i0:i0 + len(seg)] += seg
            # O Whisper costuma pôr o início da 1ª palavra dentro do silêncio antes dela: encosta no primeiro som de verdade.
            rl = rms_quadros(limpa, sr)
            limiar = rl.max() * 10 ** (-35 / 20) if len(rl) else 0
            # ataques: o som sobe depois de um respiro de silêncio. É contra eles que a legenda é medida
            # (o Whisper às vezes cola a palavra num suspiro ou respiração antes dela).
            nivel = 20 * np.log10(rl / (rl.max() + 1e-12) + 1e-9) if len(rl) else rl
            ataques = [i * 0.02 for i in range(3, len(nivel)) if nivel[i] > -30 and nivel[i - 3:i].min() < -40]
            for v, w in zip(vozes, emendar_e_ouvir(limpa, jan, sr, idioma)):
                for x in w:
                    a, b = int(x['ini'] / 0.02), int(x['fim'] / 0.02)
                    som = np.nonzero(rl[a:b] > limiar)[0] if b > a else []
                    if len(som):
                        x['ini'] = (a + som[0]) * 0.02
                v['palavras'] = w
                falas_limpas += w
            marca('fala limpa transcrita')
            if tem_final:
                todo = audio_do_video(arq, sr)
                if todo is not None:
                    for v, w in zip(vozes, emendar_e_ouvir(todo, jan, sr, idioma)):
                        v['recall'] = recall(v['palavras'], w)
                marca('mixagem transcrita')
        except Exception as e:  # noqa: BLE001
            AVISOS.append(f'transcrição (faster-whisper) não rodou: {e}')
    for v in vozes:
        v.pop('_y', None)
    m['fala'] = falas_limpas
    m['vozes'] = vozes
    m['ataques'] = locals().get('ataques', [])

    legendas = []
    if plano:
        lc = next((i for i in c['itens'] if i['tipo'] == 'legenda'), {})
        pad = lc.get('seletor') or r'^cap|legenda|caption|subtitle'
        legendas = [{'id': r['id'], 'inicio': r['inicio'], 'fim': r['inicio'] + r['dur'], 'texto': r['texto']} for r in plano.clipes if casa(r, pad) and r['texto']]
    m['legendas'] = legendas

    # itens do contrato
    m['eventosPlano'], m['eventosVideo'], m['momentos'] = [], [], []
    marcas = []
    for it in c['itens']:
        t = it['tipo']
        if t == 'revisor':
            res(it, True, '', conferido=False)
        elif t == 'batida':
            if not batidas:
                res(it, False, 'sem grade de batidas (falta a música: informe "musica" no contrato)')
                continue
            g = grade_sub(batidas, float(it.get('grade', 1)))
            tol, minf = float(it.get('tolMs', 50)), float(it.get('minFracao', 1.0 if it.get('seletor') else 0.8))
            de, ate = float(it.get('de', 0)), float(it.get('ate', dur))
            partes, ok_geral = [], True
            if it.get('seletor'):
                if not plano:
                    partes.append('sem composição para ler o plano'); ok_geral = False
                else:
                    ev = sorted({r['inicio'] + float(it.get('ajuste', 0)): r['id'] for r in plano.clipes if casa(r, it['seletor']) and de <= r['inicio'] <= ate}.items())
                    fora = []
                    for tt, rid in ev:
                        _, ms = mais_perto(tt, g)
                        okk = abs(ms) <= tol
                        m['eventosPlano'].append({'t': tt, 'ok': okk, 'ms': ms, 'rotulo': rid})
                        if not okk:
                            fora.append(f'{rid} em {ts(tt)} ({ms:+.0f} ms)')
                    fr = 1 - len(fora) / len(ev) if ev else 0
                    ok_geral &= bool(ev) and fr >= minf
                    partes.append(f'plano: {len(ev) - len(fora)}/{len(ev)} na batida (±{tol:.0f} ms)' + (f'; fora: {", ".join(fora[:6])}' if fora else '') if ev else f'plano: nenhum clipe casa com "{it["seletor"]}"')
            if it.get('eventos') == 'cortes' or (tem_final and not it.get('seletor')):
                if not tem_final:
                    partes.append('cortes do vídeo: falta o render'); ok_geral = False
                else:
                    cs = [x for x in cortes if de <= x <= ate]
                    fora = []
                    for tt in cs:
                        _, ms = mais_perto(tt, g)
                        okk = abs(ms) <= tol + 1000 / fps
                        m['eventosVideo'].append({'t': tt, 'ok': okk, 'ms': ms})
                        if not okk:
                            fora.append(f'{ts(tt)} ({ms:+.0f} ms)'); marcas.append((tt, f'corte {ms:+.0f}ms'))
                    fr = 1 - len(fora) / len(cs) if cs else 1
                    ok_geral &= fr >= minf
                    partes.append(f'vídeo: {len(cs) - len(fora)}/{len(cs)} cortes na batida' + (f'; fora: {", ".join(fora[:6])}' if fora else ''))
            res(it, ok_geral, ' · '.join(partes))
        elif t == 'momento':
            if it.get('em') is not None:
                te = float(it['em'])
            elif it.get('musicaEm') is not None and relogio is not None:
                te = float(it['musicaEm']) - float(relogio)
            else:
                res(it, False, 'momento sem "em" (segundos do vídeo) ou sem "musicaEm" + musica.inicio no contrato'); continue
            tol = float(it.get('tolMs', 80))
            mo = {'id': it['id'], 'esperado': te, 'ok': True}
            partes, okk = [f'pedido em {ts(te)}'], True
            if it.get('seletor') and plano:
                cand = [r['inicio'] + float(it.get('ajuste', 0)) for r in plano.clipes if casa(r, it['seletor'])]
                if cand:
                    tp = min(cand, key=lambda x: abs(x - te)); mo['plano'] = tp
                    ms = (tp - te) * 1000; okk &= abs(ms) <= tol
                    partes.append(f'plano {ts(tp)} ({ms:+.0f} ms)')
                else:
                    okk = False; partes.append(f'nenhum clipe casa com "{it["seletor"]}"')
            if tem_final and dif is not None:
                j = float(it.get('janela', 0.5))
                i0, i1 = max(1, int((te - j) * fps)), min(len(dif) - 1, int((te + j) * fps) + 1)
                if i1 > i0:
                    pico = i0 + int(np.argmax(dif[i0:i1]))
                    tv = pico / fps; mo['video'] = tv
                    ms = (tv - te) * 1000; okk &= abs(ms) <= tol + 1000 / fps
                    partes.append(f'no vídeo a imagem muda em {ts(tv)} ({ms:+.0f} ms)')
                marcas += [(te - 2 / fps, f'{it["id"]} antes'), (te, f'{it["id"]} pedido'), (te + 3 / fps, f'{it["id"]} depois')]
            elif not tem_final and not it.get('seletor'):
                okk = False; partes.append('falta o render (ou um "seletor" para conferir no plano)')
            mo['ok'] = okk
            m['momentos'].append(mo)
            res(it, okk, ' · '.join(partes))
        elif t == 'vozSobreMusica':
            mn = float(it.get('minDb', 10))
            med = [v for v in vozes if v.get('relacao') is not None]
            if not med:
                res(it, False, 'não deu para medir: preciso das faixas de voz e de música separadas na composição'); continue
            baixas = [v for v in med if v['relacao'] < mn]
            for v in med:
                v['ok'] = v['relacao'] >= mn
            res(it, not baixas, f'voz acima da música: mínima {min(v["relacao"] for v in med):+.1f} dB (pedido ≥ {mn:.0f})' +
                (f'; baixas: {", ".join(f"{v["id"]} {v["relacao"]:+.1f} dB" for v in baixas)}' if baixas else ''))
        elif t == 'fala':
            if not tem_final:
                res(it, False, 'falta o render para ouvir a mixagem'); continue
            med = [v for v in vozes if 'recall' in v]
            if not med:
                res(it, False, 'não deu para transcrever (faster-whisper) ou não há faixas de voz na composição'); continue
            mn = float(it.get('min', 0.85))
            ruins = [v for v in med if v['recall'] < mn]
            for v in ruins:
                v['ok'] = False
            tot = sum(len(v['palavras']) for v in med)
            ouv = sum(sum(1 for w in v['palavras'] if w.get('ouvida')) for v in med)
            res(it, not ruins, f'fala reconhecida na mixagem: {ouv}/{tot} palavras ({ouv / max(1, tot):.0%})' +
                (f'; difícil de entender: {", ".join(f"{v["id"]} {v["recall"]:.0%}" for v in ruins)}' if ruins else ''))
        elif t == 'legenda':
            if not legendas or not falas_limpas:
                res(it, False, 'sem legendas no plano ou sem fala transcrita'); continue
            tol = float(it.get('tolMs', 250))
            fora, sem = [], []
            for lg in legendas:
                p1 = norm((lg['texto'].split() or [''])[0])
                cand = [w for w in falas_limpas if w['p'] == p1 and abs(w['ini'] - lg['inicio']) < 1.5]
                if not cand:
                    sem.append(lg['id']); continue
                w = min(cand, key=lambda x: abs(x['ini'] - lg['inicio']))
                perto = [a for a in m.get('ataques', []) if w['ini'] - 0.3 <= a <= w['fim'] + 0.05]
                ini = min(perto, key=lambda a: abs(a - lg['inicio'])) if perto else w['ini']
                ms = (lg['inicio'] - ini) * 1000
                lg['ms'] = ms
                if abs(ms) > tol:
                    lg['ok'] = False; fora.append(f'"{lg["texto"][:24]}" {ms:+.0f} ms')
            res(it, not fora, f'{len(legendas) - len(sem) - len(fora)}/{len(legendas) - len(sem)} legendas no tempo da fala (±{tol:.0f} ms)' +
                (f'; fora: {", ".join(fora[:6])}' if fora else '') + (f'; {len(sem)} sem fala correspondente (letra de música, texto de tela)' if sem else ''))
        elif t == 'volume':
            som = m.get('som')
            if not som or som['lufs'] is None:
                res(it, False, 'falta o render (ou o vídeo não tem áudio)'); continue
            alvo, tol, pmax = float(it.get('lufs', -14)), float(it.get('tol', 1)), float(it.get('picoMax', -1))
            ok = abs(som['lufs'] - alvo) <= tol and (som['pico'] is None or som['pico'] <= pmax)
            res(it, ok, f"{som['lufs']:.1f} LUFS (pedido {alvo:.0f} ± {tol:g}), pico {som['pico'] if som['pico'] is not None else '?'} dBTP (máx {pmax:g})")
        elif t == 'duracao':
            if not dur:
                res(it, False, 'duração desconhecida'); continue
            ok = (it.get('igual') is None or abs(dur - float(it['igual'])) <= float(it.get('tol', 0.05))) and \
                 (it.get('min') is None or dur >= float(it['min'])) and (it.get('max') is None or dur <= float(it['max']))
            res(it, ok, f'{dur:.2f} s')
        elif t == 'formato':
            if not tem_final:
                res(it, False, 'falta o render'); continue
            erros = [f'{k} {info[k]} (pedido {it[k]})' for k in ('largura', 'altura') if it.get(k) and info[k] != it[k]]
            if it.get('fps') and abs(info['fps'] - float(it['fps'])) > 0.01:
                erros.append(f"fps {info['fps']:g} (pedido {it['fps']})")
            res(it, not erros, ', '.join(erros) or f"{info['largura']}×{info['altura']} a {info['fps']:g} fps")

    # quadros: momentos, cortes fora e, se sobrar espaço, um a cada ~4 s
    folhas = partitura(saida, dur, m) if dur else []
    if tem_final:
        if len(marcas) < 12:
            passo = max(2.0, dur / 12)
            marcas += [(t, '') for t in np.arange(0.5, dur, passo) if all(abs(t - x) > 1 for x, _ in marcas)]
        marcas.sort()
        folhas = folha_quadros(saida, arq, marcas) + folhas
    marca('folhas')

    blocos = [{'onde': f'legenda {ts(lg["inicio"])}', 'papel': 'corpo', 'texto': lg['texto'], 'origem': 'legenda'} for lg in legendas]
    blocos += [{'onde': f'{v["id"]} {ts(v["inicio"])}', 'papel': 'corpo', 'texto': ' '.join(w['bruto'] for w in v.get('palavras', [])), 'origem': 'fala'}
               for v in vozes if v.get('palavras')]
    medidas = {'duracao': dur, 'bpm': m.get('grade', {}).get('bpm'), 'batidas': len(batidas), 'cortes': len(cortes),
               'final': info, 'som': {k: v for k, v in (m.get('som') or {}).items() if k != 'silencios'},
               'vozes': [{k: v[k] for k in ('id', 'inicio', 'fim', 'relacao', 'recall') if k in v} for v in vozes],
               'momentos': m['momentos']}
    out = {'tipo': 'video', 'achados': ACHADOS, 'itens': itens, 'folhas': folhas, 'avisos': AVISOS, 'blocos': blocos, 'medidas': medidas, 'temFinal': tem_final}
    with open(os.path.join(saida, 'video.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    principal(sys.argv[1], sys.argv[2], sys.argv[3])
