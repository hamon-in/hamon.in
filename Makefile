install:
	sudo apt-get update
	sudo apt-get install curl zlib1g-dev build-essential libssl-dev libreadline-dev libyaml-dev libsqlite3-dev sqlite3 libxml2-dev libxslt1-dev libcurl4-openssl-dev python-software-properties libffi-dev nodejs -y
	wget http://ftp.ruby-lang.org/pub/ruby/2.4/ruby-2.4.0.tar.gz
	tar -xzvf ruby-2.4.0.tar.gz
	cd ruby-2.4.0/ && ./configure && make && sudo make install
	gem install jekyll -v '3.2.0'

deploy:
	JEKYLL_ENV=prod jekyll build
	rsync -rvL --rsync-path="sudo rsync" _site/  shamlik@hamon.in:/var/www/html/hamon.in
	ssh -t  shamlik@hamon.in 'sudo service nginx restart'

