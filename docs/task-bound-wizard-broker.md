# Task-bound Wizard broker

NativeTaskClient.specification sends a bounded prepare/recover request to the fixed local /task_specification endpoint. It validates the complete response against the original task, operation and canonical request hash. It rejects changed bindings, caller authority, an execution-authorized result, oversized results and a fresh preparation represented as recovery. A timeout or lost reply never triggers another request.

Preparation stores intent in the existing ModuleCore registry. Retained UUIDs recover the same specification after a restart or catalog change; changed input under the same UUID fails. Missing recovery stays missing. The short response is an intent snapshot, not proof that a candidate was built or that a capability remains callable.

This is an inert adapter addition: the existing worker advertisement, hosted job schema, website and production configuration remain unchanged. No remote Wizard capability is advertised by this commit. The next integration must add a separately typed Stargate operation, current owner/task authorization at admission and disclosure, durable result recovery, and a usable specification form. Preserve all prior native job history and existing receipt bounds.

Validation includes adapter cancellation, mismatched and unexpected response fields, lost replies without retry, and real isolated Python ModuleCore prepare/restart/recovery responses consumed by the Node validator. No private source, operator credential or model job is required by the public tests.
