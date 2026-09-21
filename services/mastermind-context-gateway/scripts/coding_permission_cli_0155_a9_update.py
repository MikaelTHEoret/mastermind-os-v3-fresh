"""Fourth exact CLI pin; preserve the accepted validator and rollback guards."""
import copy
import hashlib
import types

UPDATE_SHA = 'c3f134128a62c151a84669345665cb3d54d83a34f6a8bef47586a84a2f920069'
CLI_SHA = 'bc45017e8239dc150258f69309ced9df6bbcdf5b8e4f346decf780ac0999e226'

def transition(guards, extension, predecessor, previous, base, profile, earlier, prior, updated):
    _, accepted, _, _ = previous.transition(guards, extension, predecessor, base, profile, earlier, prior)
    if not isinstance(updated, bytes) or hashlib.sha256(updated).hexdigest() != UPDATE_SHA:
        raise ValueError('CLI_0155_A9_SOURCE_PIN_CHANGED')
    text = updated.decode('utf-8')
    old = guards.reviewed_functions(base)
    if text.count('\nCOMMIT;\n') != 1 or not text.endswith('\nCOMMIT;\n'):
        raise ValueError('CLI_0155_A9_BOUNDARY_CHANGED')
    rows = guards.new_functions(text[:-len('COMMIT;\n')]+old[1]['statement']+'\nCOMMIT;\n', None)
    if rows[1] != old[1]: raise ValueError('CLI_0155_A9_SETTER_CHANGED')
    needle = "'"+previous.CLI_SHA+"')"
    expected = accepted['statement'].replace(needle, "'"+previous.CLI_SHA+"', '"+CLI_SHA+"')")
    if accepted['statement'].count(needle) != 1 or rows[0]['statement'] != expected:
        raise ValueError('CLI_0155_A9_ONLY_EXACT_PIN_EXTENSION_ALLOWED')
    rollback = f"s->'runtime'->>'cliProfile'='{extension.PROFILE}' AND s->'runtime'->>'codexSha256'='{CLI_SHA}'"
    return accepted, rows[0], UPDATE_SHA, rollback

def render_disposable(guards, extension, predecessor, previous, base, profile, earlier, prior, updated, action):
    pair = transition(guards, extension, predecessor, previous, base, profile, earlier, prior, updated)
    return extension._render(guards, base, profile, action,
        f"current_setting('{extension.SETTING}',false)::jsonb", reviewed_transition=pair)

def render_canonical(guards, extension, predecessor, previous, preflight, base, profile, earlier, prior, updated, action):
    if not isinstance(preflight, dict) or preflight.get('extensionSha256') != UPDATE_SHA:
        raise ValueError('CLI_0155_A9_PREFLIGHT_REQUIRED')
    shape = copy.deepcopy(preflight); shape['extensionSha256'] = extension.EXTENSION_SHA
    context = guards.json_literal(extension.canonical_context(guards, shape))
    pair = transition(guards, extension, predecessor, previous, base, profile, earlier, prior, updated)
    return extension._render(guards, base, profile, action, context, reviewed_transition=pair)

def fixture_checks(guards, extension, predecessor, previous, checks, fixture, base, profile, earlier, prior, updated):
    transition(guards, extension, predecessor, previous, base, profile, earlier, prior, updated)
    def render(g, b, u, action):
        if g is not guards or b != base or u != updated: raise ValueError('CLI_0155_A9_FIXTURE_INPUT_CHANGED')
        return render_disposable(g, extension, predecessor, previous, base, profile, earlier, prior, updated, action)
    adapter = types.SimpleNamespace(render_disposable=render, PROFILE=extension.PROFILE, CLI_SHA=CLI_SHA,
        SETTER=extension.SETTER, fixture_context_capture=extension.fixture_context_capture)
    return checks.compose(guards, adapter, fixture, base, updated)

def insert_fixture(sql, guards, extension, predecessor, previous, checks, fixture, base, profile, earlier, prior, updated):
    rollback = guards.transaction_body(previous.render_disposable(guards, extension, predecessor, base, profile, earlier, prior, 'rollback'))
    seam = rollback+rollback
    if sql.count(seam) != 1: raise ValueError('CLI_0155_A9_FIXTURE_ROLLBACK_SEAM_CHANGED')
    added = fixture_checks(guards, extension, predecessor, previous, checks, fixture, base, profile, earlier, prior, updated)
    return sql.replace(seam, added+seam, 1)
