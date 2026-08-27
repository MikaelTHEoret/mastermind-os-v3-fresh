package com.mastermind.minecraft.familyagent.transport;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.config.BridgeConfig;
import com.mastermind.minecraft.familyagent.protocol.BridgeCodec;
import com.mastermind.minecraft.familyagent.protocol.BridgeProtocol;
import com.mastermind.minecraft.familyagent.protocol.ControlMessage;
import com.mastermind.minecraft.familyagent.protocol.ProtocolException;
import com.mastermind.minecraft.familyagent.protocol.TextFrameAccumulator;

import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LocalBridgeWebSocket implements AutoCloseable {
    public interface Listener {
        JsonObject bridgeHelloPayload();

        void onReady(ControlMessage.Ready ready);

        void onControl(ControlMessage message);

        void onDisconnected(String reason);
    }

    private enum State {
        CONNECTING,
        WAITING_HELLO,
        WAITING_READY,
        READY,
        ENDED
    }

    private final BridgeConfig config;
    private final Listener listener;
    private final Set<String> offeredCapabilities;
    private final BridgeCodec codec = new BridgeCodec();
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
        var thread = new Thread(runnable, "mastermind-family-bridge-reconnect");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean closed = new AtomicBoolean();

    private volatile Session current;
    private volatile int reconnectAttempt;

    public LocalBridgeWebSocket(BridgeConfig config, Listener listener, Set<String> offeredCapabilities) {
        this.config = config;
        this.listener = listener;
        this.offeredCapabilities = Set.copyOf(offeredCapabilities);
        if (this.offeredCapabilities.isEmpty() || !BridgeProtocol.ALL_CAPABILITIES.containsAll(this.offeredCapabilities)) {
            throw new IllegalArgumentException("offeredCapabilities must be a non-empty protocol subset");
        }
    }

    public void start() {
        if (!closed.get()) {
            scheduler.execute(this::connect);
        }
    }

    public boolean isReady() {
        var session = current;
        return session != null && session.state == State.READY;
    }

    public boolean supports(String capability) {
        var session = current;
        return session != null && session.state == State.READY && session.acceptedCapabilities.contains(capability);
    }

    public int heartbeatIntervalMs() {
        var session = current;
        return session == null ? 1_000 : session.heartbeatIntervalMs;
    }

    public int snapshotIntervalMs() {
        var session = current;
        return session == null ? 1_000 : session.snapshotIntervalMs;
    }

    public boolean send(String type, JsonObject payload) {
        var session = current;
        return session != null && session.sendReady(type, payload, false);
    }

    public boolean sendSnapshot(JsonObject payload) {
        var session = current;
        return session != null && session.sendReady("state.snapshot", payload, true);
    }

    public void checkLiveness(long nowNanos) {
        var session = current;
        if (session != null) {
            session.checkLiveness(nowNanos);
        }
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        var session = current;
        if (session != null) {
            session.end(1000, "client-shutdown", false);
        }
        scheduler.shutdownNow();
    }

    private void connect() {
        if (closed.get()) {
            return;
        }
        var session = new Session();
        current = session;
        httpClient.newWebSocketBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .header("Authorization", config.authorizationHeader())
            .subprotocols(BridgeProtocol.SUBPROTOCOL)
            .buildAsync(config.endpoint(), session)
            .whenComplete((ignored, error) -> {
                if (error != null) {
                    session.end(1006, "connect-failed", true);
                }
            });
    }

    private void reconnect(Session session) {
        if (closed.get() || current != session) {
            return;
        }
        listener.onDisconnected(session.disconnectReason);
        var exponent = Math.min(reconnectAttempt++, 5);
        var baseMs = Math.min(30_000L, 1_000L << exponent);
        var delayMs = baseMs + ThreadLocalRandom.current().nextLong(0, 251);
        scheduler.schedule(this::connect, delayMs, TimeUnit.MILLISECONDS);
    }

    private final class Session implements WebSocket.Listener {
        private final TextFrameAccumulator fragments = new TextFrameAccumulator();
        private final AtomicBoolean ended = new AtomicBoolean();
        private final AtomicBoolean snapshotInFlight = new AtomicBoolean();

        private volatile State state = State.CONNECTING;
        private volatile WebSocket socket;
        private volatile UUID sessionId;
        private volatile long inboundSequence;
        private volatile long outboundSequence;
        private volatile int heartbeatIntervalMs = 1_000;
        private volatile int heartbeatTimeoutMs = 6_000;
        private volatile int snapshotIntervalMs = 1_000;
        private volatile long lastServerSignalNanos = System.nanoTime();
        private volatile Set<String> acceptedCapabilities = Set.of();
        private volatile String disconnectReason = "connection-lost";
        private CompletableFuture<WebSocket> sendChain;

        @Override
        public void onOpen(WebSocket webSocket) {
            if (closed.get() || ended.get()) {
                webSocket.abort();
                return;
            }
            socket = webSocket;
            sendChain = CompletableFuture.completedFuture(webSocket);
            if (!BridgeProtocol.SUBPROTOCOL.equals(webSocket.getSubprotocol())) {
                end(4406, "subprotocol-mismatch", true);
                return;
            }
            state = State.WAITING_HELLO;
            lastServerSignalNanos = System.nanoTime();
            scheduler.schedule(() -> {
                if (state == State.WAITING_HELLO) {
                    end(4408, "hello-timeout", true);
                }
            }, 10, TimeUnit.SECONDS);
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            try {
                var complete = fragments.append(data, last);
                if (complete.isPresent()) {
                    lastServerSignalNanos = System.nanoTime();
                    receive(complete.orElseThrow());
                }
            } catch (ProtocolException error) {
                end(error.closeCode(), error.code(), true);
            } catch (RuntimeException error) {
                end(4400, "invalid-message", true);
            } finally {
                if (!ended.get()) {
                    webSocket.request(1);
                }
            }
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
            end(4400, "text-json-required", true);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onPing(WebSocket webSocket, ByteBuffer message) {
            lastServerSignalNanos = System.nanoTime();
            webSocket.sendPong(message);
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onPong(WebSocket webSocket, ByteBuffer message) {
            lastServerSignalNanos = System.nanoTime();
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            disconnectReason = statusCode == 1000 ? "closed" : "connection-lost";
            finish(true);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            end(1006, "websocket-error", true);
        }

        private void receive(String text) {
            if (state == State.WAITING_HELLO) {
                var hello = codec.decodeInitialHello(text);
                sessionId = hello.envelope().sessionId();
                inboundSequence = hello.envelope().sequence();
                heartbeatIntervalMs = hello.heartbeatIntervalMs();
                heartbeatTimeoutMs = hello.heartbeatTimeoutMs();
                state = State.WAITING_READY;
                sendDuringHandshake("bridge.hello", listener.bridgeHelloPayload());
                scheduler.schedule(() -> {
                    if (state == State.WAITING_READY) {
                        end(4408, "ready-timeout", true);
                    }
                }, hello.helloTimeoutMs(), TimeUnit.MILLISECONDS);
                return;
            }
            if (state != State.WAITING_READY && state != State.READY) {
                throw new ProtocolException("SESSION_MISMATCH", "Control frame arrived outside an active handshake", 4409);
            }
            var message = codec.decodeControl(text, sessionId, inboundSequence);
            inboundSequence = message.envelope().sequence();
            if (state == State.WAITING_READY) {
                if (!(message instanceof ControlMessage.Ready ready)) {
                    throw new ProtocolException("INVALID_HANDSHAKE", "control.ready must complete the handshake", 4408);
                }
                var accepted = Set.copyOf(ready.acceptedCapabilities());
                if (!offeredCapabilities.containsAll(accepted)) {
                    throw new ProtocolException("CAPABILITY_MISMATCH", "Control plane accepted a capability the bridge did not offer", 4400);
                }
                acceptedCapabilities = accepted;
                heartbeatIntervalMs = ready.heartbeatIntervalMs();
                snapshotIntervalMs = ready.snapshotIntervalMs();
                reconnectAttempt = 0;
                state = State.READY;
                listener.onReady(ready);
                return;
            }
            if (message instanceof ControlMessage.Hello || message instanceof ControlMessage.Ready) {
                throw new ProtocolException("INVALID_HANDSHAKE", "Handshake messages cannot be repeated", 4409);
            }
            enforceAcceptedCapability(message);
            listener.onControl(message);
        }

        private void enforceAcceptedCapability(ControlMessage message) {
            var required = switch (message) {
                case ControlMessage.Execute execute -> execute.action().kind();
                case ControlMessage.Cancel ignored -> "action.cancel";
                case ControlMessage.Shutdown ignored -> "client.shutdown";
                default -> null;
            };
            if (required != null && !acceptedCapabilities.contains(required)) {
                throw new ProtocolException("CAPABILITY_MISMATCH", "Control message requires an unaccepted capability", 4400);
            }
        }

        private boolean sendReady(String type, JsonObject payload, boolean snapshot) {
            if (state != State.READY) {
                return false;
            }
            if (snapshot && !acceptedCapabilities.contains("state.snapshot")) {
                return false;
            }
            if (snapshot && !snapshotInFlight.compareAndSet(false, true)) {
                return false;
            }
            var sent = sendPayload(type, payload);
            if (snapshot) {
                sent.whenComplete((ignored, error) -> snapshotInFlight.set(false));
            }
            return true;
        }

        private void sendDuringHandshake(String type, JsonObject payload) {
            if (state != State.WAITING_READY) {
                throw new ProtocolException("INVALID_HANDSHAKE", "Bridge hello cannot be sent in this state", 4408);
            }
            sendPayload(type, payload);
        }

        private synchronized CompletableFuture<WebSocket> sendPayload(String type, JsonObject payload) {
            if (socket == null || sendChain == null || ended.get()) {
                return CompletableFuture.failedFuture(new IllegalStateException("WebSocket is not open"));
            }
            final String text;
            try {
                text = codec.encodeClient(sessionId, ++outboundSequence, type, payload);
            } catch (RuntimeException error) {
                end(error instanceof ProtocolException protocol ? protocol.closeCode() : 4400, "invalid-client-payload", true);
                return CompletableFuture.failedFuture(error);
            }
            sendChain = sendChain.thenCompose(ignored -> socket.sendText(text, true));
            sendChain.whenComplete((ignored, error) -> {
                if (error != null) {
                    end(1006, "send-failed", true);
                }
            });
            return sendChain;
        }

        private void checkLiveness(long nowNanos) {
            if (state == State.READY && nowNanos - lastServerSignalNanos >= TimeUnit.MILLISECONDS.toNanos(heartbeatTimeoutMs)) {
                end(4408, "heartbeat-timeout", true);
            }
        }

        private void end(int code, String reason, boolean reconnect) {
            disconnectReason = reason;
            var webSocket = socket;
            if (webSocket != null && code != 1006) {
                try {
                    webSocket.sendClose(code, reason.length() > 80 ? reason.substring(0, 80) : reason);
                } catch (RuntimeException ignored) {
                    webSocket.abort();
                }
            } else if (webSocket != null) {
                webSocket.abort();
            }
            finish(reconnect);
        }

        private void finish(boolean reconnect) {
            if (!ended.compareAndSet(false, true)) {
                return;
            }
            state = State.ENDED;
            fragments.reset();
            if (reconnect && !closed.get()) {
                scheduler.execute(() -> LocalBridgeWebSocket.this.reconnect(this));
            }
        }
    }
}
