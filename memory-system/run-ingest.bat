@echo off
cd /d "C:\Users\Mik\Documents\mastermind-client"
python ingest.py %1 %2 %3 > data\ingest-task.log 2>&1
echo INGEST_DONE_MARKER >> data\ingest-task.log
