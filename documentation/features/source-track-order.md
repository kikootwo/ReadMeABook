# Source Folder Track Ordering

**Status:** Local candidate; not released

## Behavior
- Trailing disc/part labels are accepted when all siblings share the same title prefix, including `Pierce Brown - Morning Star ... Part 1-2` and `... Part 3`. Bare title numbers and differing prefixes remain unsupported.
- Resolve sibling numbered sections or consistent disc tags in each folder before flattening multi-folder audio.
- Copy and M4B merging share the same section/track order; ordinary single-folder ordering is unchanged.
- All copied multi-folder filenames receive padded `Disc NN - TTTT -` prefixes, including unique basenames and renamed files.
- Valid existing tags must agree with the resolved order. When metadata tagging is enabled, fill matching disc/track tags on import copies. Originals remain untouched.
- Conflicting tags, missing/overlapping sections, root introductions mixed with subfolders and unnumbered extras fail before copying. Error explains that ordering needs review. No title-specific ordering or music detection.
- Existing destination audio must belong to the current filename plan. Legacy flattened files require review; retries of the same plan remain supported.
- Supported prefix range: 1–99 sections and track numbers 1–9999. Larger values need review instead of overflowing the padded representation.
- Probe concurrency is limited to four processes.
- Filename-only consumers can sort the prefixes; disc-aware consumers can use filenames/tags. Tag-only consumers need metadata tagging enabled. No claim of universal player compatibility.

## Validation
- Synthetic directory/tag fixtures; shuffled input must produce the same order.
- Exercise both organizer and merger, including tagging disabled and rename enabled.
- Verify with real ffmpeg plus isolated ABS scan before production rollout.

## Related
- [File organization](../phase3/file-organization.md)
- [Chapter merging](chapter-merging.md)
