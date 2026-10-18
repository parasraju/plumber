"""
Rules for detecting visual, copywriting, and architectural AI slop tells.
"""
import re
from typing import List
from plumber.core.models import Issue, MEDIUM, LOW, CAT_SLOP
from plumber.rules import register_rule, FileContext

TW_AI_PURPLE = re.compile(r'\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b')
TW_PARTNER = re.compile(r'\b(?:from|via|to)-(?:pink|rose|blue|cyan|purple|violet|fuchsia)-\d{2,3}\b')

CSS_AI_GRADIENT = re.compile(
    r'(?:linear|radial)-gradient\([^)]*(?:#667eea|#764ba2|#a855f7|#8b5cf6|#d946ef|rgb\s*\(\s*(?:168|139|217)\s*,|purple|violet)',
    re.IGNORECASE
)

NEON_GLOW = re.compile(
    r'(?:box-shadow|shadow)\s*:\s*0\s+0\s+\d+px\s+rgba?\s*\(\s*(?:168|139|147|217|124)',
    re.IGNORECASE
)

GRADIENT_TEXT = re.compile(
    r'(?:bg-clip-text\s+text-transparent\s+bg-gradient-to|background-clip\s*:\s*text)',
    re.IGNORECASE
)

CHATBOT_RESIDUE = re.compile(
    r'(?:as\s+an\s+ai\s+language\s+model|here\s+is\s+the\s+(?:updated|complete|fixed)\s+code|certainly!\s+here\s+is|hope\s+this\s+helps!|let\s+me\s+know\s+if\s+you\s+need)',
    re.IGNORECASE
)

EMOJI_BUTTON = re.compile(r'<button[^>]*>\s*(?:[🚀✨🔥💡⚡🤖🎉💎🌟]|&[#\w]+;)\s*</button>')

EYEBROW_BADGE = re.compile(
    r'(?:NEXT-GEN|AI-POWERED|REVOLUTIONIZING|THE FUTURE OF)\b',
    re.IGNORECASE
)


@register_rule(
    "slop/ai-gradient",
    "Purple / Violet 'AI Default Gradient'",
    MEDIUM,
    CAT_SLOP,
    "The generic violet/purple-to-pink gradient used by default by AI web generators.",
    "Replace with your project's brand design system tokens or a clean neutral surface."
)
def check_ai_gradient(ctx: FileContext) -> List[Issue]:
    issues = []
    if not (ctx.is_markup or ctx.is_style or ctx.is_script):
        return []

    for line_num, line in enumerate(ctx.lines, 1):
        # Tailwind
        tw_purples = TW_AI_PURPLE.findall(line)
        tw_partners = TW_PARTNER.findall(line)
        if tw_purples and len(tw_partners) >= 2:
            issues.append(Issue(
                rule_id="slop/ai-gradient",
                title="Generic Purple/Violet AI Gradient",
                severity=MEDIUM,
                category=CAT_SLOP,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Use clean monochromatic neutrals or a curated primary brand accent.",
                description="Purple-to-pink gradient is the statistical default of AI frontends."
            ))
            continue

        # Vanilla CSS
        if CSS_AI_GRADIENT.search(line):
            issues.append(Issue(
                rule_id="slop/ai-gradient",
                title="Generic Violet/Purple CSS Gradient",
                severity=MEDIUM,
                category=CAT_SLOP,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Avoid multi-hue purple gradients; use clean single-hue depth or crisp borders.",
                description="Recognizable AI template color signature."
            ))
    return issues


@register_rule(
    "slop/neon-glow",
    "Colored Neon Glow Shadow",
    LOW,
    CAT_SLOP,
    "Purple/cyan neon glow box-shadows commonly hallucinated on card borders and hero sections.",
    "Use subtle crisp 1px borders (e.g., #262626 on dark, #e5e5e5 on light) instead of heavy neon blurs."
)
def check_neon_glow(ctx: FileContext) -> List[Issue]:
    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if NEON_GLOW.search(line):
            issues.append(Issue(
                rule_id="slop/neon-glow",
                title="Neon Blur Glow Shadow",
                severity=LOW,
                category=CAT_SLOP,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Replace with 1px border or subtle neutral shadow.",
                description="Overused aesthetic tell of AI frontends."
            ))
    return issues


@register_rule(
    "slop/chatbot-residue",
    "Pasted Chatbot Conversational Residue",
    MEDIUM,
    CAT_SLOP,
    "Documentation or source comments contain chatbot boilerplate ('Here is the code', 'As an AI language model').",
    "Delete conversational boilerplate and retain only technical instructions."
)
def check_chatbot_residue(ctx: FileContext) -> List[Issue]:
    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        match = CHATBOT_RESIDUE.search(line)
        if match:
            issues.append(Issue(
                rule_id="slop/chatbot-residue",
                title="Chatbot Conversational Residue",
                severity=MEDIUM,
                category=CAT_SLOP,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Remove the pasted chatbot introductory/closing pleasantries.",
                description=f"Matched conversational phrase: '{match.group(0)}'."
            ))
    return issues


@register_rule(
    "slop/gradient-text",
    "Gradient-Clipped Headline Text",
    LOW,
    CAT_SLOP,
    "Headline text using bg-clip-text with multi-color gradient fills.",
    "Use solid, high-contrast typography with a bold/semibold weight for clarity and accessibility."
)
def check_gradient_text(ctx: FileContext) -> List[Issue]:
    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if GRADIENT_TEXT.search(line):
            issues.append(Issue(
                rule_id="slop/gradient-text",
                title="Gradient-Clipped Text",
                severity=LOW,
                category=CAT_SLOP,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Use crisp solid font color for readability and high contrast.",
                description="Common visual cliché in generated AI landing pages."
            ))
    return issues


@register_rule(
    "ui/important-abuse",
    "!important Overrides in Stylesheet",
    LOW,
    CAT_SLOP,
    "Heavy use of !important indicates specificity fighting instead of structured cascade.",
    "Remove !important and structure CSS cascade order cleanly."
)
def check_important_abuse(ctx: FileContext) -> List[Issue]:
    issues = []
    if not (ctx.is_style or ctx.is_markup):
        return []
    for line_num, line in enumerate(ctx.lines, 1):
        if "!important" in line:
            issues.append(Issue(
                rule_id="ui/important-abuse",
                title="!important Override",
                severity=LOW,
                category=CAT_SLOP,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Remove !important and resolve specificity at the source.",
                description="Piles of !important mean styles are fighting each other."
            ))
    return issues

