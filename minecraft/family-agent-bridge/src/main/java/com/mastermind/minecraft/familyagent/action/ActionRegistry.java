package com.mastermind.minecraft.familyagent.action;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public final class ActionRegistry {
    private static final int TERMINAL_CACHE_LIMIT = 128;

    @FunctionalInterface
    public interface Cancellation {
        void cancel(String reason);
    }

    public enum BeginResult {
        STARTED,
        ALREADY_ACTIVE,
        ALREADY_TERMINAL,
        BUSY
    }

    public record ActiveAction(UUID actionId, String kind) {
    }

    public record TerminalAction(UUID actionId, String kind, String status) {
    }

    private record RegisteredAction(ActionCommand command, Cancellation cancellation) {
    }

    private final LinkedHashMap<UUID, TerminalAction> terminals = new LinkedHashMap<>();
    private RegisteredAction active;

    public BeginResult begin(ActionCommand command, Cancellation cancellation) {
        Objects.requireNonNull(command, "command");
        Objects.requireNonNull(cancellation, "cancellation");
        synchronized (this) {
            if (terminals.containsKey(command.actionId())) {
                return BeginResult.ALREADY_TERMINAL;
            }
            if (active != null && active.command().actionId().equals(command.actionId())) {
                return BeginResult.ALREADY_ACTIVE;
            }
            if (active != null) {
                return BeginResult.BUSY;
            }
            active = new RegisteredAction(command, cancellation);
        }
        return BeginResult.STARTED;
    }

    public boolean cancel(UUID actionId, String reason) {
        Objects.requireNonNull(actionId, "actionId");
        Objects.requireNonNull(reason, "reason");
        RegisteredAction cancelled;
        synchronized (this) {
            if (active == null || !active.command().actionId().equals(actionId)) {
                return false;
            }
            cancelled = active;
            active = null;
            remember(cancelled.command(), "cancelled");
        }
        cancelled.cancellation().cancel(reason);
        return true;
    }

    public boolean cancelAll(String reason) {
        Objects.requireNonNull(reason, "reason");
        RegisteredAction cancelled;
        synchronized (this) {
            cancelled = active;
            active = null;
            if (cancelled != null) {
                remember(cancelled.command(), "cancelled");
            }
        }
        if (cancelled == null) {
            return false;
        }
        cancelled.cancellation().cancel(reason);
        return true;
    }

    public synchronized boolean complete(UUID actionId, String status) {
        Objects.requireNonNull(actionId, "actionId");
        if (active == null || !active.command().actionId().equals(actionId)) {
            return false;
        }
        var completed = active.command();
        active = null;
        remember(completed, status);
        return true;
    }

    public synchronized Optional<ActiveAction> active() {
        if (active == null) {
            return Optional.empty();
        }
        return Optional.of(new ActiveAction(active.command().actionId(), active.command().kind()));
    }

    public synchronized Optional<TerminalAction> terminal(UUID actionId) {
        return Optional.ofNullable(terminals.get(actionId));
    }

    public synchronized int terminalCount() {
        return terminals.size();
    }

    private void remember(ActionCommand command, String status) {
        terminals.put(command.actionId(), new TerminalAction(command.actionId(), command.kind(), status));
        while (terminals.size() > TERMINAL_CACHE_LIMIT) {
            var first = terminals.entrySet().iterator().next();
            terminals.remove(first.getKey());
        }
    }
}
