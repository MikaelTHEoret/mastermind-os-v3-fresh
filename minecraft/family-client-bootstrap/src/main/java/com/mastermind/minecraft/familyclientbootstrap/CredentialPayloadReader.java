package com.mastermind.minecraft.familyclientbootstrap;

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

final class CredentialPayloadReader {
    static final int MAX_FRAME_BYTES = 32 * 1024;
    private static final byte[] MAGIC = {'M', 'F', 'C', '1'};
    private static final int MIN_FRAME_BYTES = MAGIC.length + 5 * Short.BYTES;
    private static final int[] FIELD_LIMITS = {
        CredentialPayload.USERNAME_MAX_BYTES,
        CredentialPayload.UUID_MAX_BYTES,
        CredentialPayload.ACCESS_TOKEN_MAX_BYTES,
        CredentialPayload.XUID_MAX_BYTES,
        CredentialPayload.CLIENT_ID_MAX_BYTES,
    };

    private CredentialPayloadReader() {}

    static CredentialPayload readAndClose(InputStream source) throws BootstrapFailure {
        if (source == null) throw invalid("Credential stdin is unavailable.");
        byte[] frame = null;
        char[][] fields = new char[FIELD_LIMITS.length][];
        boolean transferred = false;
        try (InputStream input = source; DataInputStream data = new DataInputStream(input)) {
            int frameLength;
            try {
                frameLength = data.readInt();
            } catch (EOFException error) {
                throw invalid("Credential stdin ended before the frame length.");
            }
            if (frameLength < MIN_FRAME_BYTES || frameLength > MAX_FRAME_BYTES) {
                throw invalid("Credential frame length is outside the allowed range.");
            }
            frame = new byte[frameLength];
            try {
                data.readFully(frame);
            } catch (EOFException error) {
                throw invalid("Credential stdin ended before the complete frame.");
            }

            ByteBuffer payload = ByteBuffer.wrap(frame);
            for (byte expected : MAGIC) {
                if (!payload.hasRemaining() || payload.get() != expected) {
                    throw invalid("Credential frame magic or version is invalid.");
                }
            }
            for (int index = 0; index < FIELD_LIMITS.length; index += 1) {
                if (payload.remaining() < Short.BYTES) throw invalid("Credential frame omitted a field length.");
                int length = Short.toUnsignedInt(payload.getShort());
                if (length < 1 || length > FIELD_LIMITS[index]) {
                    throw invalid("Credential field length is outside the allowed range.");
                }
                if (payload.remaining() < length) throw invalid("Credential frame ended inside a field.");
                byte[] encoded = new byte[length];
                payload.get(encoded);
                try {
                    fields[index] = decodeStrictUtf8(encoded);
                } finally {
                    Arrays.fill(encoded, (byte) 0);
                }
            }
            if (payload.hasRemaining()) throw invalid("Credential frame contains trailing payload data.");
            if (data.read() != -1) throw invalid("Credential stdin contains data after the declared frame.");
            CredentialPayload credentials = new CredentialPayload(fields[0], fields[1], fields[2], fields[3], fields[4]);
            transferred = true;
            return credentials;
        } catch (BootstrapFailure failure) {
            throw failure;
        } catch (IOException error) {
            throw invalid("Credential stdin could not be read.");
        } finally {
            if (frame != null) Arrays.fill(frame, (byte) 0);
            if (!transferred) {
                for (char[] field : fields) if (field != null) Arrays.fill(field, '\0');
            }
        }
    }

    private static char[] decodeStrictUtf8(byte[] encoded) throws BootstrapFailure {
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
            throw invalid("Credential field is not strict UTF-8.");
        }
    }

    private static BootstrapFailure invalid(String message) {
        return new BootstrapFailure(BootstrapFailure.Kind.CREDENTIAL_FRAME_INVALID, message);
    }
}
