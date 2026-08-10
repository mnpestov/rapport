import sys

from author_sync_lib.main import main, sample_details, backfill_details

if __name__ == "__main__":
    if '--sample-details' in sys.argv:
        sample_details()
    elif '--backfill-details' in sys.argv:
        idx = sys.argv.index('--backfill-details')
        author_arg = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else None
        backfill_details(author_arg)
    else:
        main()
