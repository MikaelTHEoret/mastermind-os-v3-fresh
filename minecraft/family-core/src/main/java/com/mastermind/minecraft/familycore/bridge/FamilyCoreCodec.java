package com.mastermind.minecraft.familycore.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.mastermind.minecraft.familycore.protocol.FamilyCoreProtocol;

import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

public final class FamilyCoreCodec {
    private static final Set<String> ENVELOPE_KEYS = Set.of(
        "protocol", "version", "messageId", "sessionId", "seq", "sentAt",
        "source", "type", "correlationId", "payload"
    );
    private static final Set<String> COMPUTER_STATUSES = Set.of(
        "received", "working", "awaiting-approval", "completed", "rejected", "failed"
    );
    private static final Pattern CANONICAL_TIMESTAMP = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");
    private static final Pattern UNSAFE_TEXT = Pattern.compile("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\\u202A-\\u202E\\u2066-\\u2069]");
    private static final DateTimeFormatter MILLIS_UTC = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();

    public record ControlFrame(UUID messageId, long sequence, String type, UUID correlationId, JsonObject payload) {}

    public String encodeServer(UUID sessionId, long sequence, String type, JsonObject payload, UUID correlationId) {
        return encodeServer(sessionId, sequence, type, payload, correlationId, UUID.randomUUID());
    }

    public String encodeServer(UUID sessionId, long sequence, String type, JsonObject payload, UUID correlationId, UUID messageId) {
        if (!FamilyCoreProtocol.SERVER_MESSAGE_TYPES.contains(type)) throw new IllegalArgumentException("Unsupported Family Core server message");
        FamilyCoreProtocol.requireSequence(sequence);
        JsonObject envelope = new JsonObject();
        envelope.addProperty("protocol", FamilyCoreProtocol.NAME);
        envelope.addProperty("version", FamilyCoreProtocol.VERSION);
        envelope.addProperty("messageId", messageId.toString());
        envelope.addProperty("sessionId", sessionId.toString());
        envelope.addProperty("seq", sequence);
        envelope.addProperty("sentAt", MILLIS_UTC.format(Instant.now()));
        envelope.addProperty("source", "family-core");
        envelope.addProperty("type", type);
        if (correlationId == null) envelope.add("correlationId", JsonNull.INSTANCE);
        else envelope.addProperty("correlationId", correlationId.toString());
        envelope.add("payload", payload.deepCopy());
        String encoded = envelope.toString();
        if (encoded.getBytes(StandardCharsets.UTF_8).length > FamilyCoreProtocol.MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Family Core message exceeds the payload limit");
        }
        return encoded;
    }

    public ControlFrame decodeControl(String text, UUID expectedSessionId, long previousSequence) {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > FamilyCoreProtocol.MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Family Core control payload is invalid");
        }
        JsonElement parsed = parseStrict(text);
        if (!parsed.isJsonObject()) throw new IllegalArgumentException("Family Core envelope must be an object");
        JsonObject envelope = parsed.getAsJsonObject();
        exactKeys(envelope, ENVELOPE_KEYS, "envelope");
        requireString(envelope, "protocol", 1, 64);
        if (!FamilyCoreProtocol.NAME.equals(envelope.get("protocol").getAsString())
            || requireLong(envelope, "version") != FamilyCoreProtocol.VERSION) {
            throw new IllegalArgumentException("Family Core protocol version is unsupported");
        }
        UUID messageId = requireUuid(envelope, "messageId");
        UUID sessionId = requireUuid(envelope, "sessionId");
        if (!expectedSessionId.equals(sessionId)) throw new IllegalArgumentException("Family Core session id does not match");
        long sequence = requireLong(envelope, "seq");
        if (sequence != previousSequence + 1) throw new IllegalArgumentException("Family Core sequence must be contiguous");
        String sentAt = requireString(envelope, "sentAt", 24, 24);
        if (!CANONICAL_TIMESTAMP.matcher(sentAt).matches()) throw new IllegalArgumentException("Family Core timestamp is not canonical");
        Instant.parse(sentAt);
        if (!"control-plane".equals(requireString(envelope, "source", 1, 32))) {
            throw new IllegalArgumentException("Family Core control source is invalid");
        }
        String type = requireString(envelope, "type", 1, 64);
        if (!FamilyCoreProtocol.CONTROL_MESSAGE_TYPES.contains(type)) throw new IllegalArgumentException("Unsupported Family Core control message");
        UUID correlationId = envelope.get("correlationId").isJsonNull() ? null : requireUuid(envelope, "correlationId");
        if (!envelope.get("payload").isJsonObject()) throw new IllegalArgumentException("Family Core payload must be an object");
        JsonObject payload = envelope.getAsJsonObject("payload");
        validateControlPayload(type, payload);
        return new ControlFrame(messageId, sequence, type, correlationId, payload.deepCopy());
    }

    private static void validateControlPayload(String type, JsonObject payload) {
        switch (type) {
            case "computer.broadcast" -> {
                exactKeys(payload, Set.of("text"), type);
                requireString(payload, "text", 1, 512);
            }
            case "computer.private" -> {
                exactKeys(payload, Set.of("minecraftUuid", "text"), type);
                requireUuid(payload, "minecraftUuid");
                requireString(payload, "text", 1, 2_048);
            }
            case "computer.requestStatus" -> {
                exactKeys(payload, Set.of("requestId", "status", "message"), type);
                requireUuid(payload, "requestId");
                String status = requireString(payload, "status", 1, 32);
                if (!COMPUTER_STATUSES.contains(status)) throw new IllegalArgumentException("Computer request status is invalid");
                requireString(payload, "message", 1, 512);
            }
            default -> throw new IllegalArgumentException("Control feature is not enabled by this Family Core build");
        }
    }

    private static JsonElement parseStrict(String text) {
        try {
            JsonReader reader = new JsonReader(new StringReader(text));
            reader.setLenient(false);
            JsonElement result = readElement(reader, 0);
            if (reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException("Trailing JSON content is not allowed");
            return result;
        } catch (IOException | RuntimeException error) {
            if (error instanceof IllegalArgumentException illegal) throw illegal;
            throw new IllegalArgumentException("Family Core payload is not strict JSON", error);
        }
    }

    private static JsonElement readElement(JsonReader reader, int depth) throws IOException {
        if (depth > 48) throw new IllegalArgumentException("Family Core JSON is nested too deeply");
        return switch (reader.peek()) {
            case BEGIN_OBJECT -> {
                JsonObject object = new JsonObject();
                Set<String> keys = new HashSet<>();
                reader.beginObject();
                while (reader.hasNext()) {
                    String name = reader.nextName();
                    if (!keys.add(name)) throw new IllegalArgumentException("Duplicate JSON field is not allowed");
                    object.add(name, readElement(reader, depth + 1));
                }
                reader.endObject();
                yield object;
            }
            case BEGIN_ARRAY -> {
                JsonArray array = new JsonArray();
                reader.beginArray();
                while (reader.hasNext()) array.add(readElement(reader, depth + 1));
                reader.endArray();
                yield array;
            }
            case STRING -> new JsonPrimitive(reader.nextString());
            case NUMBER -> new JsonPrimitive(new BigDecimal(reader.nextString()));
            case BOOLEAN -> new JsonPrimitive(reader.nextBoolean());
            case NULL -> { reader.nextNull(); yield JsonNull.INSTANCE; }
            default -> throw new IllegalArgumentException("Family Core payload contains invalid JSON");
        };
    }

    private static void exactKeys(JsonObject object, Set<String> expected, String label) {
        if (!object.keySet().equals(expected)) throw new IllegalArgumentException(label + " fields do not match the protocol");
    }

    private static String requireString(JsonObject object, String key, int minimum, int maximum) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException(key + " must be text");
        }
        String text = value.getAsString();
        if (text.length() < minimum || text.length() > maximum || UNSAFE_TEXT.matcher(text).find()) {
            throw new IllegalArgumentException(key + " is outside its allowed bounds");
        }
        return text;
    }

    private static long requireLong(JsonObject object, String key) {
        JsonElement value = object.get(key);
        try {
            if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new NumberFormatException();
            long result = value.getAsBigDecimal().longValueExact();
            if (result < 1) throw new NumberFormatException();
            return result;
        } catch (ArithmeticException | NumberFormatException error) {
            throw new IllegalArgumentException(key + " must be a positive integer", error);
        }
    }

    private static UUID requireUuid(JsonObject object, String key) {
        return FamilyCoreProtocol.requireUuid(requireString(object, key, 36, 36), key);
    }
}
