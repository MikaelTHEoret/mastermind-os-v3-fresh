package com.mastermind.minecraft.familyagent.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;

import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.util.HashSet;

final class StrictJsonParser {
    private static final int MAX_DEPTH = 32;

    private StrictJsonParser() {
    }

    static JsonElement parse(String input) {
        try {
            var reader = new JsonReader(new StringReader(input));
            reader.setStrictness(Strictness.STRICT);
            var result = readValue(reader, 0);
            if (reader.peek() != JsonToken.END_DOCUMENT) {
                throw invalid("JSON contains trailing data");
            }
            return result;
        } catch (IOException | IllegalStateException | NumberFormatException error) {
            if (error instanceof ProtocolException protocol) {
                throw protocol;
            }
            throw invalid("Payload is not strict JSON");
        }
    }

    private static JsonElement readValue(JsonReader reader, int depth) throws IOException {
        if (depth > MAX_DEPTH) {
            throw invalid("JSON nesting is too deep");
        }
        return switch (reader.peek()) {
            case BEGIN_OBJECT -> readObject(reader, depth + 1);
            case BEGIN_ARRAY -> readArray(reader, depth + 1);
            case STRING -> new JsonPrimitive(reader.nextString());
            case NUMBER -> new JsonPrimitive(new BigDecimal(reader.nextString()));
            case BOOLEAN -> new JsonPrimitive(reader.nextBoolean());
            case NULL -> {
                reader.nextNull();
                yield JsonNull.INSTANCE;
            }
            default -> throw invalid("JSON contains an unexpected token");
        };
    }

    private static JsonObject readObject(JsonReader reader, int depth) throws IOException {
        var object = new JsonObject();
        var names = new HashSet<String>();
        reader.beginObject();
        while (reader.hasNext()) {
            var name = reader.nextName();
            if (!names.add(name)) {
                throw invalid("JSON contains a duplicate object key");
            }
            object.add(name, readValue(reader, depth));
        }
        reader.endObject();
        return object;
    }

    private static JsonArray readArray(JsonReader reader, int depth) throws IOException {
        var array = new JsonArray();
        reader.beginArray();
        while (reader.hasNext()) {
            array.add(readValue(reader, depth));
        }
        reader.endArray();
        return array;
    }

    private static ProtocolException invalid(String message) {
        return new ProtocolException("INVALID_JSON", message);
    }
}

