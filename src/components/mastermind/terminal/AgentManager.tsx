                              {agent?.name}
                            </span>
                          </div>
                          <div style={{
                            display: 'flex',
                            gap: '12px',
                            fontSize: '10px',
                            color: '#888888'
                          }}>
                            <span>Step {execution.steps_completed}/{execution.total_steps}</span>
                            <span>${execution.cost.toFixed(6)}</span>
                          </div>
                        </div>
                      );
                    })}

                  {executions.filter(e => e.status === 'running').length === 0 && (
                    <div style={{
                      textAlign: 'center',
                      color: '#888888',
                      padding: '32px 0',
                      fontSize: '12px'
                    }}>
                      No active agents running
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}