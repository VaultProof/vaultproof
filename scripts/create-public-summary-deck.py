from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


OUT_DIR = Path("docs/fundraising")
OUT_PATH = OUT_DIR / "vaultproof-public-summary-deck.pdf"

PAGE_W, PAGE_H = landscape(letter)
MARGIN_X = 54
MARGIN_TOP = 48
MARGIN_BOTTOM = 42

NAVY = colors.HexColor("#06101b")
INK = colors.HexColor("#102033")
MUTED = colors.HexColor("#5d6b7a")
FAINT = colors.HexColor("#d9e0e7")
GREEN = colors.HexColor("#10b981")
CYAN = colors.HexColor("#38bdf8")
AMBER = colors.HexColor("#f59e0b")
ROSE = colors.HexColor("#fb7185")
SLATE = colors.HexColor("#eef4f8")
WHITE = colors.white


def fit_text(c, text, max_width, font="Helvetica", start=28, minimum=10):
    size = start
    while size > minimum and stringWidth(text, font, size) > max_width:
        size -= 0.5
    return size


def wrap_text(c, text, max_width, font="Helvetica", size=14):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        if stringWidth(test, font, size) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paragraph(c, text, x, y, max_width, size=14, color=MUTED, leading=20, font="Helvetica"):
    c.setFillColor(color)
    c.setFont(font, size)
    for line in wrap_text(c, text, max_width, font, size):
        c.drawString(x, y, line)
        y -= leading
    return y


def title(c, text, subtitle=None, dark=False):
    color = WHITE if dark else INK
    sub_color = colors.HexColor("#bfd3e6") if dark else MUTED
    c.setFillColor(color)
    size = fit_text(c, text, PAGE_W - 2 * MARGIN_X, "Helvetica-Bold", 34, 22)
    c.setFont("Helvetica-Bold", size)
    c.drawString(MARGIN_X, PAGE_H - MARGIN_TOP - size, text)
    if subtitle:
      paragraph(c, subtitle, MARGIN_X, PAGE_H - MARGIN_TOP - size - 28, PAGE_W - 2 * MARGIN_X, 13, sub_color, 18)


def footer(c, n):
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#8b99a8"))
    c.drawString(MARGIN_X, 24, "VaultProof public summary")
    c.drawRightString(PAGE_W - MARGIN_X, 24, str(n))


def rounded_rect(c, x, y, w, h, fill, stroke=None, radius=12, sw=1):
    c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
        c.setLineWidth(sw)
    else:
        c.setStrokeColor(fill)
        c.setLineWidth(0)
    c.roundRect(x, y, w, h, radius, stroke=1 if stroke else 0, fill=1)


def chip(c, label, x, y, fill, text=WHITE):
    c.setFont("Helvetica-Bold", 9)
    pad_x = 10
    w = stringWidth(label, "Helvetica-Bold", 9) + pad_x * 2
    rounded_rect(c, x, y, w, 20, fill, None, 10)
    c.setFillColor(text)
    c.drawString(x + pad_x, y + 6, label)
    return x + w + 8


def bullet_list(c, items, x, y, max_width, color=INK):
    c.setFont("Helvetica", 13)
    for item in items:
        c.setFillColor(GREEN)
        c.circle(x + 4, y + 5, 3, fill=1, stroke=0)
        y = paragraph(c, item, x + 18, y, max_width - 18, 13, color, 18)
        y -= 8
    return y


def slide_cover(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#0f766e"))
    c.circle(PAGE_W - 110, PAGE_H - 100, 180, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#0ea5e9"))
    c.circle(PAGE_W - 260, 90, 130, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 48)
    c.drawString(MARGIN_X, 305, "VaultProof")
    c.setFont("Helvetica", 22)
    c.setFillColor(colors.HexColor("#d5e7f7"))
    c.drawString(MARGIN_X, 268, "Secure API keys and AI agent traffic without exposing plaintext secrets.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN_X, 206, "PUBLIC SUMMARY DECK")
    c.setFont("Helvetica", 12)
    c.setFillColor(colors.HexColor("#b8c7d9"))
    c.drawString(MARGIN_X, 184, "Prepared for investor and partner review")


def slide_problem(c):
    title(c, "The problem: AI adoption increases secret exposure")
    c.setFillColor(FAINT)
    c.rect(0, 0, PAGE_W, 150, fill=1, stroke=0)
    bullets = [
        "Teams are adding OpenAI, Anthropic, Stripe, GitHub, and other API providers across apps, CI, agents, and internal tools.",
        "Traditional secret managers still often hand plaintext credentials to code, workflows, or runtime environments.",
        "Once a key leaks, teams need rotation, policy, audit, and blast-radius control quickly.",
    ]
    bullet_list(c, bullets, MARGIN_X, 300, 470)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 25)
    c.drawRightString(PAGE_W - MARGIN_X, 126, "Secrets are becoming runtime governance problems.")
    c.setFont("Helvetica", 13)
    c.setFillColor(MUTED)
    c.drawRightString(PAGE_W - MARGIN_X, 98, "The risk is no longer just storage. It is how credentials are used.")


def slide_solution(c):
    title(c, "VaultProof: a security layer for API and AI provider access")
    x0 = MARGIN_X
    y = 310
    stages = [
        ("Store", "Split and encrypt provider keys"),
        ("Govern", "Apply org, project, caller, and provider policy"),
        ("Execute", "Route approved API calls through controlled runtime"),
        ("Audit", "Capture evidence, usage, and policy events"),
    ]
    gap = 16
    w = (PAGE_W - 2 * MARGIN_X - gap * 3) / 4
    for i, (head, body) in enumerate(stages):
        x = x0 + i * (w + gap)
        rounded_rect(c, x, y, w, 132, colors.HexColor("#f5faf8"), colors.HexColor("#c8e6dd"), 14)
        c.setFillColor(GREEN if i < 3 else CYAN)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(x + 18, y + 82, head)
        paragraph(c, body, x + 18, y + 57, w - 36, 12, MUTED, 16)
    paragraph(c, "VaultProof gives developers a drop-in way to protect provider keys while giving security teams policy, audit, and control over how those keys are used.", MARGIN_X, 160, PAGE_W - 2 * MARGIN_X, 16, INK, 23, "Helvetica-Bold")


def slide_product(c):
    title(c, "Product suite")
    products = [
        ("VaultProof Protect", "Key storage, scanning, and leak response for exposed API credentials.", GREEN),
        ("VaultProof Gateway", "Secure API/provider proxy that keeps plaintext keys out of app runtimes.", CYAN),
        ("VaultProof Control", "Policy, RBAC, SSO, alerts, and admin controls for enterprise teams.", AMBER),
        ("VaultProof Evidence", "Audit logs, exports, and compliance proof for security reviews.", ROSE),
    ]
    card_w = (PAGE_W - 2 * MARGIN_X - 24) / 2
    card_h = 102
    start_y = 284
    for i, (head, body, accent) in enumerate(products):
        col = i % 2
        row = i // 2
        x = MARGIN_X + col * (card_w + 24)
        y = start_y - row * 126
        rounded_rect(c, x, y, card_w, card_h, colors.HexColor("#f8fafc"), colors.HexColor("#dbe5ee"), 12)
        c.setFillColor(accent)
        c.rect(x, y, 7, card_h, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(x + 22, y + 66, head)
        paragraph(c, body, x + 22, y + 42, card_w - 44, 12, MUTED, 16)
    paragraph(c, "Modular packaging lets teams start with key protection, then expand into governed traffic and audit-ready evidence.", MARGIN_X, 64, PAGE_W - 2 * MARGIN_X, 13, INK, 19, "Helvetica-Bold")


def slide_market(c):
    title(c, "Why now")
    c.setFont("Helvetica-Bold", 30)
    c.setFillColor(INK)
    c.drawString(MARGIN_X, 316, "AI turns API keys into")
    c.drawString(MARGIN_X, 280, "production risk.")
    paragraph(c, "Model calls, agents, tool integrations, and provider APIs are moving directly into product workflows. Every integration adds a credential, policy, and audit surface.", MARGIN_X, 236, 360, 14, MUTED, 20)
    signals = [
        ("More providers", "Model, payment, email, repo, and workflow APIs are spreading across teams."),
        ("More autonomy", "Agents and automations can call tools faster than humans can review logs."),
        ("More scrutiny", "Enterprise buyers want policy, SSO, audit trails, and compliance evidence."),
    ]
    y = 318
    for label, body in signals:
        rounded_rect(c, PAGE_W - 326, y - 52, 272, 64, colors.HexColor("#f8fafc"), colors.HexColor("#dbe5ee"), 12)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(PAGE_W - 306, y - 12, label)
        paragraph(c, body, PAGE_W - 306, y - 30, 232, 10.5, MUTED, 14)
        y -= 84


def slide_architecture(c):
    title(c, "Architecture direction", "Public-safe view of the trust boundary.")
    y = 276
    labels = [
        ("Developer / App", "Uses provider SDK or proxy URL"),
        ("VaultProof Control Plane", "Auth, policy, audit, routing"),
        ("Secure Runtime", "Approved execution path"),
        ("Provider API", "OpenAI, Anthropic, Stripe, etc."),
    ]
    x = MARGIN_X
    box_w = 138
    step = 170
    for i, (head, body) in enumerate(labels):
        rounded_rect(c, x, y, box_w, 94, colors.HexColor("#f8fafc"), colors.HexColor("#ccd7e2"), 12)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 10.5)
        head_y = y + 66
        head_lines = wrap_text(c, head, box_w - 24, "Helvetica-Bold", 10.5)
        for line in head_lines:
            c.drawString(x + 12, head_y, line)
            head_y -= 13
        paragraph(c, body, x + 12, head_y - 6, box_w - 24, 9.25, MUTED, 11.5)
        if i < len(labels) - 1:
            c.setStrokeColor(GREEN)
            c.setLineWidth(2)
            c.line(x + box_w + 8, y + 47, x + step - 8, y + 47)
            c.line(x + step - 16, y + 54, x + step - 8, y + 47)
            c.line(x + step - 16, y + 40, x + step - 8, y + 47)
        x += step
    paragraph(c, "Design principle: the control plane enforces authorization and signs the execution path. Plaintext provider secrets should not be exposed to users or ordinary application runtimes.", MARGIN_X, 158, PAGE_W - 2 * MARGIN_X, 14, INK, 20, "Helvetica-Bold")


def slide_business(c):
    title(c, "Business model")
    rows = [
        ("Land", "VaultProof Protect starts with subscription tiers for teams managing key storage, scans, projects, and leak response."),
        ("Expand", "VaultProof Gateway and Control add secure API execution, policy, SSO, RBAC, alerts, and admin workflows."),
        ("Prove", "VaultProof Evidence and enterprise add-ons create audit exports, compliance proof, retention, and premium support."),
    ]
    y = 316
    desc_x = MARGIN_X + 256
    desc_w = PAGE_W - desc_x - MARGIN_X
    for i, (head, body) in enumerate(rows):
        c.setFillColor([GREEN, CYAN, AMBER][i])
        c.rect(MARGIN_X, y - 8, 8, 64, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(MARGIN_X + 24, y + 30, head)
        paragraph(c, body, desc_x, y + 30, desc_w, 12.5, MUTED, 17)
        y -= 92


def slide_gtm(c):
    title(c, "Go-to-market")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(MARGIN_X, 322, "Land with urgent developer pain.")
    c.setFont("Helvetica-Bold", 24)
    c.drawString(MARGIN_X, 224, "Expand into enterprise governance.")
    c.setStrokeColor(GREEN)
    c.setLineWidth(3)
    c.line(MARGIN_X, 286, PAGE_W - MARGIN_X, 286)
    c.line(MARGIN_X, 188, PAGE_W - MARGIN_X, 188)
    paragraph(c, "Free/public scanner, CLI onboarding, and a drop-in provider proxy help developers protect keys quickly.", MARGIN_X, 268, 560, 12.5, MUTED, 17)
    paragraph(c, "Team orgs, RBAC, SSO, audit export, alerts, policy enforcement, and confidential execution create the enterprise expansion path.", MARGIN_X, 170, 590, 12.5, MUTED, 17)
    chip(c, "Developers", MARGIN_X, 112, GREEN)
    chip(c, "Security teams", MARGIN_X + 100, 112, CYAN)
    chip(c, "Platform teams", MARGIN_X + 224, 112, AMBER)


def slide_competition(c):
    title(c, "Positioning")
    cols = ["Secret managers", "API gateways", "VaultProof"]
    rows = [
        ("Stores secrets", "Yes", "Sometimes", "Yes"),
        ("Prevents plaintext exposure", "Partial", "No", "Designed for it"),
        ("Provider-call policy", "Limited", "Yes", "Yes"),
        ("Developer setup", "Heavy", "Platform-led", "Drop-in path"),
        ("Audit for AI/API use", "Limited", "Network logs", "First-class"),
    ]
    x0 = MARGIN_X
    y0 = 335
    col_w = [190, 160, 160, 190]
    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(MUTED)
    x = x0 + col_w[0]
    for col in cols:
        c.drawString(x + 8, y0, col)
        x += col_w[1]
    y = y0 - 36
    for label, a, b, d in rows:
        c.setStrokeColor(FAINT)
        c.line(x0, y + 22, PAGE_W - MARGIN_X, y + 22)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x0, y, label)
        x = x0 + col_w[0]
        for value in [a, b, d]:
            c.setFillColor(GREEN if value in ["Yes", "Designed for it", "First-class"] else MUTED)
            c.setFont("Helvetica", 11)
            c.drawString(x + 8, y, value)
            x += col_w[1]
        y -= 42


def slide_roadmap(c):
    title(c, "Roadmap")
    items = [
        ("Now", "Protect, Gateway, Control, and Evidence product surfaces for teams and enterprise buyers."),
        ("Next", "Enterprise policy UX, SSO hardening, audit/evidence exports, customer pilots."),
        ("Later", "Dedicated confidential runtimes, customer gateway/APIM integrations, secure AI gateway expansion."),
    ]
    x = MARGIN_X
    for i, (phase, body) in enumerate(items):
        rounded_rect(c, x, 170, 205, 160, colors.HexColor("#f8fafc"), colors.HexColor("#d8e1ea"), 16)
        c.setFillColor([GREEN, CYAN, AMBER][i])
        c.setFont("Helvetica-Bold", 16)
        c.drawString(x + 20, 285, phase)
        paragraph(c, body, x + 20, 252, 165, 13, MUTED, 18)
        x += 225


def slide_use_of_funds(c):
    title(c, "Use of funds")
    items = [
        "Harden secure runtime and enterprise deployment operations.",
        "Complete enterprise policy, SSO, audit, alerting, and evidence workflows.",
        "Support customer pilots and security reviews.",
        "Evaluate accelerated secure gateway and confidential AI infrastructure where it improves product performance.",
        "Invest in developer-focused go-to-market and onboarding.",
    ]
    bullet_list(c, items, MARGIN_X, 320, PAGE_W - 2 * MARGIN_X)
    c.setFillColor(SLATE)
    c.rect(0, 0, PAGE_W, 78, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN_X, 44, "Goal: turn a working security product into a repeatable enterprise platform.")


def slide_close(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN_X, 346, "THE ASK")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 36)
    c.drawString(MARGIN_X, 298, "Help us make secure AI/API access")
    c.drawString(MARGIN_X, 256, "the default enterprise path.")
    paragraph(c, "VaultProof is building the control layer between developers, enterprise policy, and the provider APIs powering modern AI products.", MARGIN_X, 188, 620, 17, colors.HexColor("#d5e7f7"), 25)
    c.setFillColor(colors.HexColor("#d5e7f7"))
    c.setFont("Helvetica", 13)
    c.drawString(MARGIN_X, 90, "vaultproof.dev")


SLIDES = [
    slide_cover,
    slide_problem,
    slide_solution,
    slide_product,
    slide_market,
    slide_architecture,
    slide_business,
    slide_gtm,
    slide_competition,
    slide_roadmap,
    slide_use_of_funds,
    slide_close,
]


def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT_PATH), pagesize=landscape(letter))
    for idx, slide in enumerate(SLIDES, start=1):
        slide(c)
        if idx not in (1, len(SLIDES)):
            footer(c, idx)
        c.showPage()
    c.save()


if __name__ == "__main__":
    build()
    print(OUT_PATH)
