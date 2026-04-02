#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <libmtp.h>

#define FOLDER_SCORCRDS  16777263
#define FOLDER_ACTIVITY  16777249
#define STORAGE_ID       0x00020001
#define MIN_GOLF_SIZE    50000
#define MAX_ROUNDS       100

typedef struct {
    uint32_t id;
    char     filename[64];
    uint64_t filesize;
    time_t   mtime;
} FileEntry;

static int cmp_id_desc(const void *a, const void *b) {
    const FileEntry *fa = (const FileEntry *)a;
    const FileEntry *fb = (const FileEntry *)b;
    return (fb->id > fa->id) - (fb->id < fa->id);
}

int main(int argc, char *argv[]) {
    // Args: dest_dir [count=1] [offset=0]
    const char *dest_dir = argc > 1 ? argv[1] : "/tmp";
    int count  = argc > 2 ? atoi(argv[2]) : 1;
    int offset = argc > 3 ? atoi(argv[3]) : 0;
    if (count < 1 || count > MAX_ROUNDS) count = 1;

    // Redirect libmtp noise to stderr
    FILE *saved = fdopen(dup(fileno(stdout)), "w");
    freopen("/dev/stderr", "w", stdout);
    LIBMTP_Init();
    LIBMTP_Set_Debug(0);
    dup2(fileno(saved), fileno(stdout));
    fclose(saved);

    LIBMTP_raw_device_t *rawdevs;
    int numdevs;
    if (LIBMTP_Detect_Raw_Devices(&rawdevs, &numdevs) != 0 || numdevs == 0) {
        fprintf(stderr, "No MTP device found\n"); return 1;
    }
    LIBMTP_mtpdevice_t *dev = LIBMTP_Open_Raw_Device_Uncached(&rawdevs[0]);
    if (!dev) { fprintf(stderr, "Failed to open device\n"); return 1; }

    // Collect all scorecard files, sort by ID descending
    FileEntry sc_files[MAX_ROUNDS * 2];
    int sc_count = 0;
    LIBMTP_file_t *f = LIBMTP_Get_Files_And_Folders(dev, STORAGE_ID, FOLDER_SCORCRDS);
    while (f && sc_count < MAX_ROUNDS * 2) {
        if (strcmp(f->filename, "Clubs.fit") != 0 && f->filesize > 0) {
            sc_files[sc_count].id       = f->item_id;
            sc_files[sc_count].filesize = f->filesize;
            sc_files[sc_count].mtime    = f->modificationdate;
            strncpy(sc_files[sc_count].filename, f->filename, 63);
            sc_count++;
        }
        f = f->next;
    }
    qsort(sc_files, sc_count, sizeof(FileEntry), cmp_id_desc);

    // Collect all activity files indexed by mtime
    FileEntry act_files[MAX_ROUNDS * 10];
    int act_count = 0;
    LIBMTP_file_t *a = LIBMTP_Get_Files_And_Folders(dev, STORAGE_ID, FOLDER_ACTIVITY);
    while (a && act_count < MAX_ROUNDS * 10) {
        if (a->filesize >= MIN_GOLF_SIZE) {
            act_files[act_count].id       = a->item_id;
            act_files[act_count].filesize = a->filesize;
            act_files[act_count].mtime    = a->modificationdate;
            strncpy(act_files[act_count].filename, a->filename, 63);
            act_count++;
        }
        a = a->next;
    }

    // Output JSON array
    printf("[\n");
    int downloaded = 0;
    int skipped    = 0;

    for (int i = 0; i < sc_count && downloaded < count; i++) {
        FileEntry *sc = &sc_files[i];

        // Find matching activity by mtime (within 60s)
        FileEntry *best_act = NULL;
        long best_diff = 999999;
        for (int j = 0; j < act_count; j++) {
            long diff = labs((long)act_files[j].mtime - (long)sc->mtime);
            if (diff < best_diff) { best_diff = diff; best_act = &act_files[j]; }
        }
        if (!best_act || best_diff > 3600) continue;

        // Apply offset
        if (skipped < offset) { skipped++; continue; }

        // Build dest paths
        char sc_dest[512], act_dest[512];
        snprintf(sc_dest,  sizeof(sc_dest),  "%s/%s",          dest_dir, sc->filename);
        snprintf(act_dest, sizeof(act_dest), "%s/%s",          dest_dir, best_act->filename);

        // Download scorecard
        if (LIBMTP_Get_File_To_File(dev, sc->id, sc_dest, NULL, NULL) != 0) {
            fprintf(stderr, "Failed to download scorecard %s\n", sc->filename);
            continue;
        }
        // Download activity
        if (LIBMTP_Get_File_To_File(dev, best_act->id, act_dest, NULL, NULL) != 0) {
            fprintf(stderr, "Failed to download activity %s\n", best_act->filename);
            continue;
        }

        if (downloaded > 0) printf(",\n");
        printf("  {\n");
        printf("    \"scorecard\": \"%s\",\n",      sc_dest);
        printf("    \"scorecard_name\": \"%s\",\n", sc->filename);
        printf("    \"scorecard_mtime\": %ld,\n",   (long)sc->mtime);
        printf("    \"activity\": \"%s\",\n",        act_dest);
        printf("    \"activity_name\": \"%s\",\n",  best_act->filename);
        printf("    \"activity_mtime\": %ld,\n",    (long)best_act->mtime);
        printf("    \"activity_size\": %llu\n",     (unsigned long long)best_act->filesize);
        printf("  }");

        downloaded++;
    }

    printf("\n]\n");
    LIBMTP_Release_Device(dev);
    return downloaded > 0 ? 0 : 1;
}
