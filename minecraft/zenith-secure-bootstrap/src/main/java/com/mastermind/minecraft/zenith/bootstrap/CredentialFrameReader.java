package com.mastermind.minecraft.zenith.bootstrap;

import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

final class CredentialFrameReader {
    static final int MAX_FRAME_BYTES = 32 * 1024;
    private static final byte[] MAGIC = {'M', 'F', 'C', '1'};
    private static final int[] FIELD_LIMITS = {16, 36, 24 * 1024, 20, 36};
    private static final int MIN_FRAME_BYTES = MAGIC.length + FIELD_LIMITS.length * Short.BYTES;

    private CredentialFrameReader() {}

    static CredentialFrame readAndClose(InputStream source) throws IOException {
        if (source == null) throw new IOException("CREDENTIAL_STDIN_UNAVAILABLE");
        byte[] frame = null;
        char[][] fields = new char[FIELD_LIMITS.length][];
        boolean transferred = false;
        try (InputStream input = source; DataInputStream data = new DataInputStream(input)) {
            int length;
            try {
                length = data.readInt();
            } catch (EOFException error) {
                throw new IOException("CREDENTIAL_FRAME_INVALID");
            }
            if (length < MIN_FRAME_BYTES || length > MAX_FRAME_BYTES) {
                throw new IOException("CREDENTIAL_FRAME_INVALID");
            }
            frame = new byte[length];
            data.readFully(frame);
            ByteBuffer payload = ByteBuffer.wrap(frame);
            for (byte expected : MAGIC) {
                if (!payload.hasRemaining() || payload.get() != expected) {
                    throw new IOException("CREDENTIAL_FRAME_INVALID");
                }
            }
            for (int index = 0; index < FIELD_LIMITS.length; index += 1) {
                if (payload.remaining() < Short.BYTES) throw new IOException("CREDENTIAL_FRAME_INVALID");
                int fieldLength = Short.toUnsignedInt(payload.getShort());
                if (fieldLength < 1 || fieldLength > FIELD_LIMITS[index] || payload.remaining() < fieldLength) {
                    throw new IOException("CREDENTIAL_FRAME_INVALID");
                }
                byte[] encoded = new byte[fieldLength];
                payload.get(encoded);
                try {
                    fields[index] = decodeStrictUtf8(encoded);
                } finally {
                    Arrays.fill(encoded, (byte) 0);
                }
            }
            if (payload.hasRemaining() || data.read() != -1) throw new IOException("CREDENTIAL_FRAME_INVALID");
            CredentialFrame result = new CredentialFrame(fields[0], fields[1], fields[2], fields[3], fields[4]);
            transferred = true;
            return result;
        } finally {
            if (frame != null) Arrays.fill(frame, (byte) 0);
            if (!transferred) for (char[] field : fields) if (field != null) Arrays.fill(field, '\0');
        }
    }

    private static char[] decodeStrictUtf8(byte[] encoded) throws IOException {
        try {
            CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(encoded));
            char[] result = new char[decoded.remaining()];
            decoded.get(result);
            if (decoded.hasArray()) Arrays.fill(decoded.array(), '\0');
            return result;
        } catch (CharacterCodingException error) {
            throw new IOException("CREDENTIAL_FRAME_INVALID");
        }
    }
}
