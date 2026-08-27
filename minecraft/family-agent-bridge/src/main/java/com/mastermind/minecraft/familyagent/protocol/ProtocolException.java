package com.mastermind.minecraft.familyagent.protocol;

public final class ProtocolException extends RuntimeException {
    private final String code;
    private final int closeCode;

    public ProtocolException(String code, String message) {
        this(code, message, 4400);
    }

    public ProtocolException(String code, String message, int closeCode) {
        super(message);
        this.code = code;
        this.closeCode = closeCode;
    }

    public String code() {
        return code;
    }

    public int closeCode() {
        return closeCode;
    }
}

