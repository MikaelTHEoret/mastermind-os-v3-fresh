package com.mastermind.minecraft.familycore.bridge;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familycore.protocol.FamilyCoreProtocol;

import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class FamilyCoreWebSocket implements AutoCloseable {
    public interface Listener {
        JsonObject helloPayload();
        void onReady();
        void onControl(FamilyCoreCodec.ControlFrame frame);
        void onDisconnected(String reason);
    }

    private final ServerBridgeConfig config;
    private final Listener listener;
    private final FamilyCoreCodec codec = new FamilyCoreCodec();
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "mastermind-family-core-reconnect");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile Session current;
    private volatile int reconnectAttempt;

    public FamilyCoreWebSocket(ServerBridgeConfig config, Listener listener) {
        if (!config.enabled()) throw new IllegalArgumentException("Family Core server bridge must be enabled");
        this.config = config;
        this.listener = listener;
    }

    public void start() {
        if (!closed.get()) scheduler.execute(this::connect);
    }

    public boolean isReady() {
        Session session = current;
        return session != null && session.ready && !session.ended.get();
    }

    public String status() {
        Session session = current;
        if (closed.get()) return "stopped";
        if (session == null) return "connecting";
        return session.ready ? "ready" : "connecting";
    }

    public UUID send(String type, JsonObject payload, UUID correlationId) {
        Session session = current;
        return session != null ? session.send(type, payload, correlationId) : null;
    }

    public void heartbeat(long uptimeMs, int playerCount) {
        Session session = current;
        if (session == null || !session.ready) return;
        JsonObject payload = new JsonObject();
        payload.addProperty("uptimeMs", Math.max(0, uptimeMs));
        payload.addProperty("playerCount", Math.max(0, playerCount));
        payload.addProperty("lastControlSeq", session.inboundSequence);
        session.send("server.heartbeat", payload, null);
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        Session session = current;
        if (session != null) session.end(1000, "server-stopping", false);
        scheduler.shutdownNow();
    }

    private void connect() {
        if (closed.get()) return;
        final String authorization;
        try {
            authorization = config.authorizationHeader();
        } catch (Exception error) {
            scheduleReconnect(null, "credential-unavailable");
            return;
        }
        Session session = new Session();
        current = session;
        httpClient.newWebSocketBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .header("Authorization", authorization)
            .subprotocols(FamilyCoreProtocol.SUBPROTOCOL)
            .buildAsync(config.endpoint(), session)
            .whenComplete((ignored, error) -> {
                if (error != null) session.end(1006, "connect-failed", true);
            });
    }

    private void scheduleReconnect(Session session, String reason) {
        if (closed.get() || (session != null && current != session)) return;
        listener.onDisconnected(reason);
        int exponent = Math.min(reconnectAttempt++, 5);
        long baseMs = Math.min(30_000L, 1_000L << exponent);
        long delayMs = baseMs + ThreadLocalRandom.current().nextLong(0, 251);
        scheduler.schedule(this::connect, delayMs, TimeUnit.MILLISECONDS);
    }

    private final class Session implements WebSocket.Listener {
        private final StringBuilder fragments = new StringBuilder();
        private final AtomicBoolean ended = new AtomicBoolean();
        private final Set<UUID> inboundMessageIds = new HashSet<>();
        private volatile WebSocket socket;
        private volatile boolean ready;
        private volatile long inboundSequence;
        private volatile long outboundSequence;
        private CompletableFuture<WebSocket> sendChain;

        @Override
        public void onOpen(WebSocket webSocket) {
            if (closed.get() || ended.get()) {
                webSocket.abort();
                return;
            }
            socket = webSocket;
            sendChain = CompletableFuture.completedFuture(webSocket);
            if (!FamilyCoreProtocol.SUBPROTOCOL.equals(webSocket.getSubprotocol())) {
                end(4406, "subprotocol-mismatch", true);
                return;
            }
            UUID helloId = send("server.hello", listener.helloPayload(), null);
            if (helloId == null) {
                end(1006, "hello-send-failed", true);
                return;
            }
            ready = true;
            reconnectAttempt = 0;
            listener.onReady();
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            try {
                if (fragments.length() + data.length() > FamilyCoreProtocol.MAX_PAYLOAD_BYTES) {
                    throw new IllegalArgumentException("Family Core text frame is too large");
                }
                fragments.append(data);
                if (last) {
                    String text = fragments.toString();
                    fragments.setLength(0);
                    FamilyCoreCodec.ControlFrame frame = codec.decodeControl(text, config.sessionId(), inboundSequence);
                    if (!inboundMessageIds.add(frame.messageId())) throw new IllegalArgumentException("Duplicate Family Core message id");
                    if (inboundMessageIds.size() > 1_024) inboundMessageIds.remove(inboundMessageIds.iterator().next());
                    inboundSequence = frame.sequence();
                    listener.onControl(frame);
                }
            } catch (RuntimeException error) {
                end(4400, "invalid-control-frame", true);
            } finally {
                if (!ended.get()) webSocket.request(1);
            }
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
            end(1003, "text-json-required", true);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onPing(WebSocket webSocket, ByteBuffer message) {
            webSocket.sendPong(message);
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onPong(WebSocket webSocket, ByteBuffer message) {
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            finish(statusCode == 1000 ? "closed" : "connection-lost", statusCode != 1000);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            end(1006, "websocket-error", true);
        }

        private synchronized UUID send(String type, JsonObject payload, UUID correlationId) {
            if (socket == null || sendChain == null || ended.get()) return null;
            UUID messageId = UUID.randomUUID();
            String text = codec.encodeServer(config.sessionId(), ++outboundSequence, type, payload, correlationId, messageId);
            sendChain = sendChain.thenCompose(ignored -> socket.sendText(text, true));
            sendChain.whenComplete((ignored, error) -> {
                if (error != null) end(1006, "send-failed", true);
            });
            return messageId;
        }

        private void end(int code, String reason, boolean reconnect) {
            WebSocket webSocket = socket;
            if (webSocket != null && code != 1006) {
                try { webSocket.sendClose(code, reason); }
                catch (RuntimeException ignored) { webSocket.abort(); }
            } else if (webSocket != null) webSocket.abort();
            finish(reason, reconnect);
        }

        private void finish(String reason, boolean reconnect) {
            if (!ended.compareAndSet(false, true)) return;
            ready = false;
            fragments.setLength(0);
            if (reconnect && !closed.get()) scheduler.execute(() -> scheduleReconnect(this, reason));
        }
    }
}
