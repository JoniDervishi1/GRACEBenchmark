# if [ ! -f $DATA_DIRECTORY/yeast.json ]; then 
#     curl https://zenodo.org/records/15571202/files/yeast.json?download=1 > $DATA_DIRECTORY/yeast.json
# fi

# if [ ! -f $DATA_DIRECTORY/mico.json ]; then 
#     curl https://zenodo.org/records/15571202/files/mico.json?download=1 > $DATA_DIRECTORY/mico.json
# fi
if [ ! -f $DATA_DIRECTORY/ldbc.json ]; then 
    curl https://zenodo.org/records/15571202/files/ldbc.json?download=1 > $DATA_DIRECTORY/ldbc.json
fi
# if [ ! -f $DATA_DIRECTORY/frbo.json ]; then 
#     curl https://zenodo.org/records/15571202/files/freebase_org.json?download=1 > $DATA_DIRECTORY/frbo.json
# fi
# if [ ! -f $DATA_DIRECTORY/frbs.json ]; then 
#     curl https://zenodo.org/records/15571202/files/freebase_small.json?download=1 > $DATA_DIRECTORY/frbs.json
# fi
# if [ ! -f $DATA_DIRECTORY/frbm.json ]; then 
#     curl https://zenodo.org/records/15571202/files/freebase_medium.json?download=1 > $DATA_DIRECTORY/frbm.json
# fi

#if [ ! -f $DATA_DIRECTORY/ldbc0.1.json ]; then 
#    ./downloadLDBCData.sh https://repository.surfsara.nl/datasets/cwi/ldbc-snb-interactive-v1-datagen-v100/files/social_network-sf0.1-CsvBasic-LongDateFormatter.tar.zst
#    mv social_network-sf0.1-CsvBasic-LongDateFormatter.tar.zst $DATA_DIRECTORY/
#    cd $DATA_DIRECTORY
#    tar --use-compress-program=unzstd -xvf social_network-sf0.1-CsvBasic-LongDateFormatter.tar.zst
#    python3 $ROOT_DIRECTORY/LDBCtojson.py ./social_network-sf0.1-CsvBasic-LongDateFormatter/ ldbc0.1.json
#    rm -rf social_network-sf0.1-CsvBasic-LongDateFormatter/ social_network-sf0.1-CsvBasic-LongDateFormatter.tar.zst
#    cd $ROOT_DIRECTORY
#fi

# if [ ! -f $DATA_DIRECTORY/ldbc1.json ]; then 
#     ./downloadLDBCData.sh https://repository.surfsara.nl/datasets/cwi/ldbc-snb-interactive-v1-datagen-v100/files/social_network-sf1-CsvBasic-LongDateFormatter.tar.zst
#     mv social_network-sf1-CsvBasic-LongDateFormatter.tar.zst $DATA_DIRECTORY/
#     cd $DATA_DIRECTORY
#     tar --use-compress-program=unzstd -xvf social_network-sf1-CsvBasic-LongDateFormatter.tar.zst
#     python3 $ROOT_DIRECTORY/LDBCtojson.py ./social_network-sf1-CsvBasic-LongDateFormatter/ ldbc1.json
#     rm -rf social_network-sf1-CsvBasic-LongDateFormatter/ social_network-sf1-CsvBasic-LongDateFormatter.tar.zst
#     cd $ROOT_DIRECTORY
# fi

# if [ ! -f $DATA_DIRECTORY/ldbc3.json ]; then 
#     ./downloadLDBCData.sh https://repository.surfsara.nl/datasets/cwi/ldbc-snb-interactive-v1-datagen-v100/files/social_network-sf3-CsvBasic-LongDateFormatter.tar.zst
#     mv social_network-sf3-CsvBasic-LongDateFormatter.tar.zst $DATA_DIRECTORY/
#     cd $DATA_DIRECTORY
#     tar --use-compress-program=unzstd -xvf social_network-sf3-CsvBasic-LongDateFormatter.tar.zst
#     python3 $ROOT_DIRECTORY/LDBCtojson.py ./social_network-sf3-CsvBasic-LongDateFormatter/ ldbc3.json
#     rm -rf social_network-sf3-CsvBasic-LongDateFormatter/ social_network-sf3-CsvBasic-LongDateFormatter.tar.zst
#     cd $ROOT_DIRECTORY
# fi


cp $ROOT_DIRECTORY/scripts/utilities/workloadGenerator.py $DATA_DIRECTORY/
cp $ROOT_DIRECTORY/scripts/utilities/jsontoCSV.py $DATA_DIRECTORY/

cd $DATA_DIRECTORY 

echo "Generating workload for dataset: $DATASET_NAME"
if [ ! -f ${DATASET_NAME}_load_vertices.json ] || [ ! -f ${DATASET_NAME}_load_edges.json ]; then 
    python3 workloadGenerator.py --input $DATASET_NAME.json --out-prefix $DATASET_NAME --split 0.8 --shards $(nproc --all)
fi

echo "Converting JSON to CSV for dataset: $DATASET_NAME"
python3 jsontoCSV.py ${DATASET_NAME}_load_vertices.json ${DATASET_NAME}_load_edges.json 

