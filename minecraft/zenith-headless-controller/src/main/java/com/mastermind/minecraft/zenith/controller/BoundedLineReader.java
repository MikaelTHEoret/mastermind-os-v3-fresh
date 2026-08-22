package com.mastermind.minecraft.zenith.controller;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class BoundedLineReader {
    private BoundedLineReader() {}

    static String read(InputStream input, int maximumBytes) throws IOException {
        if (maximumBytes < 1) throw new IllegalArgumentException("maximumBytes");
        var bytes = new ByteArrayOutputStream(Math.min(1024, maximumBytes));
        while (true) {
            int value = input.read();
            if (value == -1 && bytes.size() == 0) return null;
            if (value == -1 || value == '\n') break;
            if (bytes.size() >= maximumBytes) throw new IOException("INPUT_TOO_LARGE");
            bytes.write(value);
        }
        byte[] raw = bytes.toByteArray();
        int length = raw.length;
        if (length > 0 && raw[length - 1] == '\r') length--;
        return new String(raw, 0, length, StandardCharsets.UTF_8);
    }
}
