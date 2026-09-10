"""Synthetic extension acceptance embedded in the existing rollback-only fixture."""
import copy
import hashlib
import json


CONTROLS = ['profile_apply', 'profile_replay', 'legacy_profile_preserved',
    'suppressed_exact_cli', 'wrong_cli_hold', 'unknown_profile_hold',
    'actual_suppressed_scope_and_replay', 'historical_profile_rebind_hold',
    'current_suppressed_scope_rollback_hold', 'profile_rollback', 'profile_rollback_replay',
    'changed_validator_hold', 'changed_validator_acl_hold', 'missing_validator_hold',
    'protected_setter_hold', 'protected_schema_hold', 'extension_progress_preserved']


def compose(guards, extension_guard, fixture, base, extension):
    apply = guards.transaction_body(extension_guard.render_disposable(guards, base, extension, 'apply'))
    rollback = guards.transaction_body(extension_guard.render_disposable(guards, base, extension, 'rollback'))
    old_scope = {**copy.deepcopy(fixture['v1']), 'schemaVersion': 2,
                 'codingSources': [copy.deepcopy(fixture['codingEntry'])]}
    scope = copy.deepcopy(old_scope)
    entry = scope['codingSources'][0]
    entry['runtime'].update(cliProfile=extension_guard.PROFILE, codexSha256=extension_guard.CLI_SHA)
    entry['taskBinding'] = {'checkpointId': '00000000-0000-4000-8000-000000000007', 'revision': '7'}
    body = json.dumps(scope, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    digest = hashlib.sha256(body.encode()).hexdigest()
    literal = guards.literal
    old = guards.json_literal(old_scope)
    new = guards.json_literal(scope)
    task, actor, project = (fixture[key] for key in ('taskId', 'actorId', 'project'))
    command = ("public.set_mastermind_context_task_permissions_v2("
        "'00000000-0000-4000-8000-000000000007'," + literal(digest) + ',' + literal(task)
        + ",'fixture'," + literal(actor) + ',' + literal(project) + ',6,0,' + literal(body) + ',' + literal(digest) + ')')
    changed = copy.deepcopy(scope)
    changed_entry = changed['codingSources'][0]
    changed_entry['runtime']['cliProfile'] = fixture['codingEntry']['runtime']['cliProfile']
    changed_entry['taskBinding'] = {'checkpointId': '00000000-0000-4000-8000-000000000008', 'revision': '8'}
    changed_body = json.dumps(changed, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    changed_digest = hashlib.sha256(changed_body.encode()).hexdigest()
    rebind = ("public.set_mastermind_context_task_permissions_v2("
        "'00000000-0000-4000-8000-000000000008'," + literal(changed_digest) + ',' + literal(task)
        + ",'fixture'," + literal(actor) + ',' + literal(project) + ',7,1,' + literal(changed_body) + ',' + literal(changed_digest) + ')')

    def negative(change, expected):
        return f"""DO $profile_negative$ BEGIN
          BEGIN
            {change}
            EXECUTE {literal(apply)};
            RAISE EXCEPTION 'PROFILE_NEGATIVE_UNEXPECTEDLY_ACCEPTED';
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM<>{literal(expected)} THEN RAISE; END IF;
          END;
        END $profile_negative$;
"""

    negatives = ''.join([
        negative("""CREATE OR REPLACE FUNCTION public.validate_mastermind_coding_sources_v2(p_scope jsonb)
          RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp
          AS $changed_profile_body$ BEGIN NULL; END; $changed_profile_body$;""",
          'PROFILE_EXTENSION_VALIDATOR_PREIMAGE_CHANGED'),
        negative('REVOKE EXECUTE ON FUNCTION public.validate_mastermind_coding_sources_v2(jsonb) FROM PUBLIC;',
                 'PROFILE_EXTENSION_VALIDATOR_PREIMAGE_CHANGED'),
        negative('DROP FUNCTION public.validate_mastermind_coding_sources_v2(jsonb) RESTRICT;',
                 'PROFILE_EXTENSION_VALIDATOR_ABSENT_OR_OVERLOADED'),
        negative('REVOKE EXECUTE ON FUNCTION '+extension_guard.SETTER+' FROM PUBLIC;',
                 'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED'),
        negative('ALTER TABLE public.mastermind_context_tasks_v1 ADD COLUMN fixture_profile_extra text;',
                 'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED'),
    ])
    checks = f"""DO $profile_contract$
DECLARE s jsonb:={new}; bad jsonb; task_before jsonb; history_before jsonb; result text;
BEGIN
  PERFORM public.validate_mastermind_coding_sources_v2({old});
  PERFORM public.validate_mastermind_coding_sources_v2(s);
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_set(s,'{{codingSources,0,runtime,codexSha256}}',to_jsonb(repeat('0',64))),
    jsonb_set(s,'{{codingSources,0,runtime,cliProfile}}','"unknown-profile"'),
    jsonb_set(s,'{{codingSources,0,runtime,cliProfile}}','null'),
    jsonb_set(s,'{{codingSources,0,runtime,cliProfile}}','17')
  )) LOOP
    BEGIN
      PERFORM public.validate_mastermind_coding_sources_v2(bad);
      RAISE EXCEPTION 'INVALID_SUPPRESSED_PROFILE_ACCEPTED';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  SELECT to_jsonb(t) INTO task_before FROM public.mastermind_context_tasks_v1 t;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) INTO history_before FROM public.mastermind_context_checkpoints_v1 t;
  BEGIN
    SELECT result_status INTO result FROM {command};
    IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'SUPPRESSED_SCOPE_NOT_APPLIED'; END IF;
    SELECT result_status INTO result FROM {command};
    IF result IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'SUPPRESSED_SCOPE_REPLAY_CHANGED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1
      WHERE checkpoint_id='00000000-0000-4000-8000-000000000007' AND permission_scope=s
        AND completed_items='["earlier complete"]'::jsonb AND open_items='["earlier open"]'::jsonb
        AND blockers='["earlier blocker"]'::jsonb) THEN
      RAISE EXCEPTION 'SUPPRESSED_CHECKPOINT_PROGRESS_CHANGED';
    END IF;
    BEGIN
      PERFORM * FROM {rebind};
      RAISE EXCEPTION 'HISTORICAL_PROFILE_REBOUND';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    BEGIN
      EXECUTE {literal(rollback)};
      RAISE EXCEPTION 'CURRENT_SUPPRESSED_SCOPE_ROLLBACK_ACCEPTED';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM<>'RESTORE_CURRENT_SUPPRESSED_SCOPES_BEFORE_PROFILE_ROLLBACK' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ROLLBACK_SUCCESSFUL_SYNTHETIC_PROFILE_GRANT';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM<>'ROLLBACK_SUCCESSFUL_SYNTHETIC_PROFILE_GRANT' THEN RAISE; END IF;
  END;
  IF (SELECT to_jsonb(t) FROM public.mastermind_context_tasks_v1 t) IS DISTINCT FROM task_before
    OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) FROM public.mastermind_context_checkpoints_v1 t) IS DISTINCT FROM history_before THEN
    RAISE EXCEPTION 'PROFILE_FIXTURE_PROGRESS_NOT_RESTORED';
  END IF;
END;
$profile_contract$;
"""
    after = f"""DO $profile_restored$ BEGIN
  PERFORM public.validate_mastermind_coding_sources_v2({old});
  BEGIN
    PERFORM public.validate_mastermind_coding_sources_v2({new});
    RAISE EXCEPTION 'PROFILE_ROLLBACK_DID_NOT_RESTORE_OLD_VALIDATOR';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $profile_restored$;
"""
    return extension_guard.fixture_context_capture(guards) + negatives + apply + apply + checks + rollback + rollback + after


def insert_before_legacy_checks(base_sql, extension_sql):
    marker = 'CREATE FUNCTION pg_temp.fixture_canonical(v jsonb)'
    if not isinstance(base_sql, str) or base_sql.count(marker) != 1:
        raise ValueError('PROFILE_FIXTURE_INSERTION_BOUNDARY_CHANGED')
    return base_sql.replace(marker, extension_sql + marker, 1)
