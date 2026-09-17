"""Third exact CLI pin; preserve the accepted validator and rollback guards."""
import copy
import hashlib
import types

UPDATE_SHA = '41aa8805a1dd1cc351ee9890e701304d92a27f036581954218889167a723bbf6'
CLI_SHA = 'be793ab45adbcbd9fa716df04cb6bc68eb9e353c6e6af20886af45c11abc2413'

def transition(guards, extension, previous, base, profile, prior, updated):
    _, accepted, _, _ = previous.transition(guards, extension, base, profile, prior)
    if not isinstance(updated, bytes) or hashlib.sha256(updated).hexdigest() != UPDATE_SHA:
        raise ValueError('CLI_0155_SOURCE_PIN_CHANGED')
    text = updated.decode('utf-8')
    old = guards.reviewed_functions(base)
    if text.count('\nCOMMIT;\n') != 1 or not text.endswith('\nCOMMIT;\n'):
        raise ValueError('CLI_0155_BOUNDARY_CHANGED')
    rows = guards.new_functions(text[:-len('COMMIT;\n')]+old[1]['statement']+'\nCOMMIT;\n', None)
    if rows[1] != old[1]: raise ValueError('CLI_0155_SETTER_CHANGED')
    needle = "'"+previous.CLI_SHA+"')"
    expected = accepted['statement'].replace(needle, "'"+previous.CLI_SHA+"', '"+CLI_SHA+"')")
    if accepted['statement'].count(needle) != 1 or rows[0]['statement'] != expected:
        raise ValueError('CLI_0155_ONLY_EXACT_PIN_EXTENSION_ALLOWED')
    rollback = f"s->'runtime'->>'cliProfile'='{extension.PROFILE}' AND s->'runtime'->>'codexSha256'='{CLI_SHA}'"
    return accepted, rows[0], UPDATE_SHA, rollback

def render_disposable(guards, extension, previous, base, profile, prior, updated, action):
    pair = transition(guards, extension, previous, base, profile, prior, updated)
    return extension._render(guards, base, profile, action,
        f"current_setting('{extension.SETTING}',false)::jsonb", reviewed_transition=pair)

def render_canonical(guards, extension, previous, preflight, base, profile, prior, updated, action):
    if not isinstance(preflight, dict) or preflight.get('extensionSha256') != UPDATE_SHA:
        raise ValueError('CLI_0155_PREFLIGHT_REQUIRED')
    shape = copy.deepcopy(preflight); shape['extensionSha256'] = extension.EXTENSION_SHA
    context = guards.json_literal(extension.canonical_context(guards, shape))
    pair = transition(guards, extension, previous, base, profile, prior, updated)
    return extension._render(guards, base, profile, action, context, reviewed_transition=pair)

def fixture_checks(guards, extension, previous, checks, fixture, base, profile, prior, updated):
    transition(guards, extension, previous, base, profile, prior, updated)
    def render(g, b, u, action):
        if g is not guards or b != base or u != updated: raise ValueError('CLI_0155_FIXTURE_INPUT_CHANGED')
        return render_disposable(g, extension, previous, base, profile, prior, updated, action)
    adapter = types.SimpleNamespace(render_disposable=render, PROFILE=extension.PROFILE, CLI_SHA=CLI_SHA,
        SETTER=extension.SETTER, fixture_context_capture=extension.fixture_context_capture)
    return checks.compose(guards, adapter, fixture, base, updated)

def insert_fixture(sql, guards, extension, previous, checks, fixture, base, profile, prior, updated):
    rollback = guards.transaction_body(previous.render_disposable(guards, extension, base, profile, prior, 'rollback'))
    seam = rollback+rollback
    if sql.count(seam) != 1: raise ValueError('CLI_0155_FIXTURE_ROLLBACK_SEAM_CHANGED')
    added = fixture_checks(guards, extension, previous, checks, fixture, base, profile, prior, updated)
    return sql.replace(seam, added+seam, 1)
